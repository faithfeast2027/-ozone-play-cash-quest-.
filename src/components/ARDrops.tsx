import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, List, Compass, Loader2, Sparkles, CameraOff } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { sfx, haptic } from '@/lib/sfx';
import '@/ar-drops.css';
import WalkBuddy from '@/components/WalkBuddy';
import { buddyLine } from '@/lib/walkBuddy';
import type { PersonaId } from '@/lib/characters';

// Pokémon-Go style "AR" view for Live Map sponsored spark drops.
// No WebXR: rear camera via getUserMedia + compass (DeviceOrientation) + GPS (watchPosition),
// so it runs in iPhone Safari and Android Chrome. Collecting calls back into LiveMap's own
// check-in (the same check_in RPC), so rewards and cash eligibility are unchanged.

const CELL = 0.0005; // must match LiveMap's grid (~55 m)
const FOV = 60; // horizontal field of view in degrees
const NEAR_RADIUS_M = 1609; // show drops within ~1 mile
const RELOAD_AFTER_M = 250;
const M_TO_FT = 3.28084;

export type ARDrop = { id: string; cell_key: string; lat_i: number; lng_i: number; business_name: string; bonus: number };
export type ARFix = { lat: number; lng: number; acc: number };
export type CollectResult = { ok: boolean; text: string };

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const norm360 = (d: number) => ((d % 360) + 360) % 360;
const keyOfFix = (f: ARFix) => `${Math.floor(f.lat / CELL)}:${Math.floor(f.lng / CELL)}`;

function haversine(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function bearing(aLat: number, aLng: number, bLat: number, bLng: number) {
  const y = Math.sin(toRad(bLng - aLng)) * Math.cos(toRad(bLat));
  const x = Math.cos(toRad(aLat)) * Math.sin(toRad(bLat)) - Math.sin(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.cos(toRad(bLng - aLng));
  return norm360(toDeg(Math.atan2(y, x)));
}
/** Metres from the player to the nearest edge of the drop's cell (0 when standing inside it). */
function distToCell(f: ARFix, d: ARDrop) {
  const s = d.lat_i * CELL, w = d.lng_i * CELL;
  const lat = Math.min(Math.max(f.lat, s), s + CELL), lng = Math.min(Math.max(f.lng, w), w + CELL);
  return haversine(f.lat, f.lng, lat, lng);
}
function fmtDist(m: number) {
  const ft = m * M_TO_FT;
  if (ft < 1000) return `${Math.max(1, Math.round(ft / 5) * 5)} ft`;
  const mi = m / 1609.34;
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}

/** Back-camera compass heading from alpha/beta/gamma (W3C DeviceOrientation formula). */
function headingFromEuler(alpha: number, beta: number, gamma: number) {
  const x = toRad(beta), y = toRad(gamma), z = toRad(alpha);
  const cY = Math.cos(y), cZ = Math.cos(z), sX = Math.sin(x), sY = Math.sin(y), sZ = Math.sin(z);
  const vx = -cZ * sY - sZ * sX * cY;
  const vy = -sZ * sY + cZ * sX * cY;
  if (Math.hypot(vx, vy) < 0.2) return norm360(360 - alpha); // phone nearly flat: use top-edge heading
  return norm360(toDeg(Math.atan2(vx, vy)));
}

type OrientationPermission = 'granted' | 'denied' | 'not-needed';
type DOE = DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number };

/** Call from the AR button's tap handler (iOS needs a user gesture for this prompt). */
export async function requestOrientationPermission(): Promise<OrientationPermission> {
  const D = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
  if (D && typeof D.requestPermission === 'function') {
    try { return (await D.requestPermission()) === 'granted' ? 'granted' : 'denied'; } catch { return 'denied'; }
  }
  return 'not-needed';
}

type Placed = { drop: ARDrop; dist: number; edge: number; brg: number; inRange: boolean };

export default function ARDrops({ onClose, onCollect, orientation, buddy = null }: {
  buddy?: PersonaId | null;
  onClose: () => void;
  onCollect: (fix: ARFix, drop: ARDrop) => Promise<CollectResult>;
  orientation: OrientationPermission;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cam, setCam] = useState<'starting' | 'on' | 'off'>('starting');
  const [fix, setFix] = useState<ARFix | null>(null);
  const [geo, setGeo] = useState<'locating' | 'on' | 'denied'>('locating');
  const [compass, setCompass] = useState<'waiting' | 'on' | 'none'>(orientation === 'denied' ? 'none' : 'waiting');
  const [heading, setHeading] = useState(0);
  const [pitch, setPitch] = useState(90);
  const [drops, setDrops] = useState<ARDrop[]>([]);
  const [showList, setShowList] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [collected, setCollected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<CollectResult | null>(null);
  const [buddySay, setBuddySay] = useState<string | null>(buddy ? buddyLine(buddy, 'ar') : null);
  useEffect(() => { if (buddy && toast?.ok && /collect|\+\d/i.test(toast.text)) setBuddySay(buddyLine(buddy, 'collect')); }, [toast, buddy]);
  const [burst, setBurst] = useState<{ x: number; y: number; n: number } | null>(null);
  const targetHeading = useRef<number | null>(null);
  const targetPitch = useRef(90);
  const smooth = useRef<number | null>(null);
  const smoothPitch = useRef(90);
  const lastLoad = useRef<ARFix | null>(null);
  const toastTimer = useRef<number | null>(null);

  const say = (r: CollectResult) => {
    setToast(r);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3800);
  };

  // --- rear camera ---
  useEffect(() => {
    let cancelled = false;
    const video = videoRef.current;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setCam('off'); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const v = video;
        if (v) { v.srcObject = stream; v.play().catch(() => { /* autoplay blocked: muted+playsInline usually avoids this */ }); }
        setCam('on');
      } catch { if (!cancelled) setCam('off'); }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (video) video.srcObject = null;
    };
  }, []);

  // --- GPS ---
  useEffect(() => {
    if (!navigator.geolocation) { setGeo('denied'); return; }
    const id = navigator.geolocation.watchPosition(
      ({ coords }) => { setFix({ lat: coords.latitude, lng: coords.longitude, acc: coords.accuracy }); setGeo('on'); },
      () => setGeo((g) => (g === 'on' ? g : 'denied')),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // --- compass ---
  useEffect(() => {
    if (orientation === 'denied') return;
    let gotAbsolute = false;
    const onAbs = (e: DeviceOrientationEvent) => {
      if (e.alpha == null) return;
      gotAbsolute = true;
      targetHeading.current = headingFromEuler(e.alpha, e.beta ?? 90, e.gamma ?? 0);
      if (e.beta != null) targetPitch.current = e.beta;
    };
    const onRel = (e: DeviceOrientationEvent) => {
      const ev = e as DOE;
      if (typeof ev.webkitCompassHeading === 'number' && !Number.isNaN(ev.webkitCompassHeading)) {
        targetHeading.current = norm360(ev.webkitCompassHeading); // iOS Safari: degrees from magnetic north
      } else if (!gotAbsolute && e.absolute && e.alpha != null) {
        targetHeading.current = headingFromEuler(e.alpha, e.beta ?? 90, e.gamma ?? 0); // older Android / Firefox
      } else return;
      if (e.beta != null) targetPitch.current = e.beta;
    };
    const hasAbs = 'ondeviceorientationabsolute' in window;
    if (hasAbs) window.addEventListener('deviceorientationabsolute', onAbs as EventListener);
    window.addEventListener('deviceorientation', onRel);
    const t = window.setTimeout(() => { if (targetHeading.current == null) setCompass('none'); }, 3500);
    return () => {
      window.clearTimeout(t);
      if (hasAbs) window.removeEventListener('deviceorientationabsolute', onAbs as EventListener);
      window.removeEventListener('deviceorientation', onRel);
    };
  }, [orientation]);

  // low-pass smoothing loop for heading + pitch
  useEffect(() => {
    let raf = 0, last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const tgt = targetHeading.current;
      if (tgt == null) return;
      if (smooth.current == null) { smooth.current = tgt; setCompass('on'); }
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016; last = now;
      const k = 1 - Math.exp(-dt * 7); // ~140 ms time constant
      const diff = wrap180(tgt - smooth.current);
      smooth.current = norm360(smooth.current + (Math.abs(diff) < 0.4 ? 0 : diff * k));
      smoothPitch.current += (targetPitch.current - smoothPitch.current) * k;
      setHeading(smooth.current);
      setPitch(smoothPitch.current);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // --- load nearby drops (read-only, same table LiveMap reads) ---
  const loadDrops = useCallback(async (f: ARFix) => {
    lastLoad.current = f;
    const dLat = NEAR_RADIUS_M / 111320, dLng = NEAR_RADIUS_M / (111320 * Math.max(0.2, Math.cos(toRad(f.lat))));
    const { data } = await supabase.from('sponsored_drops').select('id, cell_key, lat_i, lng_i, business_name, bonus')
      .gte('lat_i', Math.floor((f.lat - dLat) / CELL)).lte('lat_i', Math.floor((f.lat + dLat) / CELL))
      .gte('lng_i', Math.floor((f.lng - dLng) / CELL)).lte('lng_i', Math.floor((f.lng + dLng) / CELL))
      .gt('active_until', new Date().toISOString())
      .limit(200);
    setDrops((data ?? []) as ARDrop[]);
  }, []);
  useEffect(() => {
    if (!fix) return;
    const l = lastLoad.current;
    if (!l || haversine(l.lat, l.lng, fix.lat, fix.lng) > RELOAD_AFTER_M) loadDrops(fix);
  }, [fix, loadDrops]);

  const placed: Placed[] = useMemo(() => {
    if (!fix) return [];
    const here = keyOfFix(fix);
    return drops.map((d) => {
      const cLat = (d.lat_i + 0.5) * CELL, cLng = (d.lng_i + 0.5) * CELL;
      return { drop: d, dist: haversine(fix.lat, fix.lng, cLat, cLng), edge: distToCell(fix, d), brg: bearing(fix.lat, fix.lng, cLat, cLng), inRange: d.cell_key === here };
    }).filter((p) => p.dist <= NEAR_RADIUS_M * 1.1).sort((a, b) => a.dist - b.dist);
  }, [drops, fix]);

  const close = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    sfx.tap();
    onClose();
  };

  const tapDrop = async (p: Placed, at?: { x: number; y: number }) => {
    if (!fix || busyId) return;
    if (collected.has(p.drop.id)) { say({ ok: true, text: 'Already collected here. Come back in a few hours.' }); return; }
    if (!p.inRange) {
      sfx.tap(); haptic(8);
      say({ ok: false, text: `Walk closer — ${fmtDist(Math.max(p.edge, 1.5))} to ${p.drop.business_name}` });
      return;
    }
    if (fix.acc > 80) { say({ ok: false, text: 'GPS signal too weak. Step outside and try again.' }); return; }
    setBusyId(p.drop.id);
    const r = await onCollect(fix, p.drop);
    setBusyId(null);
    say(r);
    if (r.ok) {
      setCollected((s) => new Set(s).add(p.drop.id));
      sfx.claim(); window.setTimeout(() => sfx.coin(4), 120); window.setTimeout(() => sfx.ching(), 260);
      haptic([20, 40, 30]);
      setBurst({ x: at?.x ?? window.innerWidth / 2, y: at?.y ?? window.innerHeight / 2, n: Date.now() });
      window.setTimeout(() => setBurst(null), 1100);
    } else { sfx.hit(); haptic(30); }
  };

  const compassOn = compass === 'on';
  const nearest = placed[0];
  // vertical: horizon moves as you tilt the phone (beta 90 = upright)
  const pxPerDeg = (typeof window !== 'undefined' ? window.innerWidth : 390) / FOV;
  const horizon = Math.max(-0.35, Math.min(0.35, ((pitch - 90) * pxPerDeg) / (typeof window !== 'undefined' ? window.innerHeight : 800)));

  return (
    <div className="ar-root">
      <video ref={videoRef} className={`ar-video ${cam === 'on' ? 'on' : ''}`} playsInline muted autoPlay />
      {cam !== 'on' && <div className="ar-sky"><span className="ar-sky-glow" /><span className="ar-ground" /></div>}

      {/* top bar */}
      <div className="ar-top">
        <button className="ar-btn" onClick={close}><X size={15} /> Close</button>
        <span className="ar-chip"><Sparkles size={13} /> AR DROPS</span>
        {compassOn && <span className="ar-chip ar-heading"><Compass size={13} /> {Math.round(heading)}° {['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(heading / 45) % 8]}</span>}
        <button className="ar-btn" style={{ marginLeft: 'auto' }} onClick={() => setShowList((s) => !s)}><List size={15} /> {showList ? 'Hide' : 'List'}</button>
      </div>

      {cam === 'off' && <div className="ar-note"><CameraOff size={13} /> Camera is off, so you're seeing the sky view. Allow camera for this site to see drops in the real world.</div>}

      {/* gems in view */}
      {compassOn && fix && (
        <div className="ar-stage" style={{ ['--horizon' as string]: `${50 + horizon * 100}%` }}>
          {placed.map((p, i) => {
            const rel = wrap180(p.brg - heading);
            const done = collected.has(p.drop.id);
            if (Math.abs(rel) > FOV / 2 + 4) return null;
            const x = 50 + (rel / FOV) * 100;
            const near = Math.max(0, Math.min(1, 1 - Math.log10(Math.max(10, p.dist)) / Math.log10(NEAR_RADIUS_M) + 0.32));
            const size = 46 + near * 74 + (p.inRange ? 18 : 0);
            const lift = (1 - near) * 9; // far drops sit closer to the horizon
            return (
              <button key={p.drop.id} className={`ar-gem ${p.inRange ? 'in-range' : ''} ${done ? 'done' : ''}`}
                style={{ left: `${x}%`, top: `calc(var(--horizon) - ${18 - lift}%)`, width: size, height: size, opacity: 0.45 + near * 0.55, zIndex: 100 - i, animationDelay: `${(i % 5) * -0.37}s` }}
                onClick={(e) => tapDrop(p, { x: e.clientX, y: e.clientY })} aria-label={`${p.drop.business_name}, ${fmtDist(p.dist)}, +${p.drop.bonus} bonus sparks`}>
                <span className="ar-gem-glow" />
                <span className="ar-gem-core">{busyId === p.drop.id ? <Loader2 className="spin" size={18} /> : null}</span>
                <span className="ar-gem-spark s1" /><span className="ar-gem-spark s2" /><span className="ar-gem-spark s3" />
                <span className="ar-gem-label">
                  <b>{p.drop.business_name}</b>
                  <small>{done ? 'Collected ✓' : p.inRange ? `Tap to collect · +${p.drop.bonus}` : `${fmtDist(p.dist)} · +${p.drop.bonus} bonus`}</small>
                </span>
              </button>
            );
          })}
          {/* edge arrows for off-screen drops (closest per side) */}
          {(['left', 'right'] as const).map((side) => {
            const off = placed.filter((p) => { const r = wrap180(p.brg - heading); return side === 'left' ? r < -(FOV / 2 + 4) : r > FOV / 2 + 4; });
            if (!off.length) return null;
            const p = off[0];
            const turn = Math.round(Math.abs(wrap180(p.brg - heading)));
            return (
              <button key={side} className={`ar-edge ${side}`} onClick={() => say({ ok: true, text: `Turn ${side} ${turn}° to face ${p.drop.business_name} (${fmtDist(p.dist)})` })}>
                <span className="ar-edge-arrow">{side === 'left' ? '◀' : '▶'}</span>
                <span><b>{fmtDist(p.dist)}</b><small>{off.length > 1 ? `${off.length} drops` : p.drop.business_name}</small></span>
              </button>
            );
          })}
          <div className="ar-reticle" />
        </div>
      )}

      {/* status / fallbacks */}
      {geo !== 'on' && (
        <div className="ar-panel center">
          {geo === 'locating' ? <><Loader2 className="spin" size={18} /> <p>Finding you…</p></> : <p>Location is off. Turn on location for this site in your browser settings to see drops around you.</p>}
        </div>
      )}
      {geo === 'on' && compass === 'waiting' && <div className="ar-note top2"><Loader2 className="spin" size={13} /> Calibrating compass… move your phone in a figure-8.</div>}
      {geo === 'on' && compass === 'none' && (
        <div className="ar-note top2"><Compass size={13} /> {orientation === 'denied' ? 'Motion & orientation access was declined, so ' : 'No compass on this device, so '}drops are listed by distance below.</div>
      )}
      {geo === 'on' && compassOn && fix && placed.length === 0 && <div className="ar-panel center"><p>No spark drops within a mile right now. Check the map later — new drops land daily.</p></div>}

      {geo === 'on' && fix && (showList || !compassOn) && (
        <div className="ar-list">
          <p className="ar-list-title">NEARBY DROPS · {placed.length}</p>
          {placed.length === 0 && <p className="ar-list-empty">No spark drops within a mile right now.</p>}
          {placed.map((p) => {
            const done = collected.has(p.drop.id);
            return (
              <button key={p.drop.id} className={`ar-row ${p.inRange ? 'in-range' : ''}`} onClick={(e) => tapDrop(p, { x: e.clientX, y: e.clientY })}>
                <span className="ar-row-gem" />
                <span className="ar-row-main"><b>{p.drop.business_name}</b><small>+{p.drop.bonus} bonus sparks{compassOn ? ` · ${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(p.brg / 45) % 8]}` : ''}</small></span>
                <span className="ar-row-act">{busyId === p.drop.id ? <Loader2 className="spin" size={14} /> : done ? 'Collected ✓' : p.inRange ? 'Collect' : fmtDist(p.dist)}</span>
              </button>
            );
          })}
        </div>
      )}

      {geo === 'on' && compassOn && !showList && nearest && (
        <div className="ar-bottom">
          <span>Nearest: <b>{nearest.drop.business_name}</b> · {nearest.inRange ? 'you’re here — tap the gem!' : fmtDist(nearest.dist)}</span>
          {fix && fix.acc > 80 && <small>GPS ±{Math.round(fix.acc * M_TO_FT)} ft — step outside for a better signal.</small>}
        </div>
      )}

      {burst && (
        <div className="ar-burst" key={burst.n} style={{ left: burst.x, top: burst.y }}>
          {Array.from({ length: 12 }).map((_, i) => <i key={i} style={{ ['--a' as string]: `${i * 30}deg` }} />)}
        </div>
      )}
      {buddy && !showList && compassOn && <WalkBuddy id={buddy} line={buddySay} corner="bottom-right" compact />}
      {toast && <div className={`ar-toast ${toast.ok ? 'ok' : 'bad'}`} onClick={() => setToast(null)}>{toast.text}</div>}
    </div>
  );
}
