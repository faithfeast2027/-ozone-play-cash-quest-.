import { useCallback, useEffect, useRef, useState } from 'react';
import { Minus, MessageCircle } from 'lucide-react';
import { prefersReducedMotion } from '@/lib/juice';
import { sfx, haptic } from '@/lib/sfx';
import { useMascotSettings, setMascotMinimized, setMascotPos, onMascotMessage, pickLine, TIP_LINES, TAP_LINES, type MascotMood } from '@/lib/mascot';

type Props = {
  level?: number;
  username?: string;
  questsLeft: number; // daily quests not yet completed
  readyToClaim: number; // quests done but unclaimed
  suppressed?: boolean; // a game / modal / menu is open
  onChat?: () => void; // opens the Ozone AI chat (bubble "Chat" chip or long-press)
};

const BASE_SIZE = 78;
let SIZE = BASE_SIZE;
/** Ozone grows as the player levels up: +4px per level, capped at 1.7x (level 15+). */
export function mascotSizeForLevel(level: number) { return Math.round(Math.min(BASE_SIZE * 1.7, BASE_SIZE + Math.max(0, level - 1) * 4)); }
const MARGIN = 10;
const NAV_CLEAR = 92; // keeps Ozone above the floating bottom nav by default

type Sparkle = { id: number; dx: number; dy: number; c: string };
const SPARK_COLORS = ['var(--oz-orb)', '#ffd34d', '#ffffff', 'var(--oz-accent)'];

function freeArea() {
  const w = window.innerWidth; const h = window.innerHeight;
  return { minX: MARGIN, maxX: Math.max(MARGIN, w - SIZE - MARGIN), minY: 70, maxY: Math.max(70, h - SIZE - NAV_CLEAR) };
}
function toPx(p: { x: number; y: number } | null) {
  const a = freeArea();
  const fx = p ? p.x : 1; const fy = p ? p.y : 1;
  return { x: a.minX + (a.maxX - a.minX) * fx, y: a.minY + (a.maxY - a.minY) * fy };
}
function toFrac(x: number, y: number) {
  const a = freeArea();
  return { x: Math.min(1, Math.max(0, (x - a.minX) / Math.max(1, a.maxX - a.minX))), y: Math.min(1, Math.max(0, (y - a.minY) / Math.max(1, a.maxY - a.minY))) };
}

/** Avoids parking Ozone on top of the bottom nav or any element marked data-mascot-avoid. */
function nudgeClear(x: number, y: number) {
  const nav = document.querySelector('.bottom-nav');
  if (nav) {
    const r = nav.getBoundingClientRect();
    const overlaps = x < r.right && x + SIZE > r.left && y + SIZE > r.top - 6;
    if (overlaps) y = r.top - SIZE - 10;
  }
  return { x, y };
}

export default function OzoneMascot({ username, questsLeft, readyToClaim, suppressed, level = 1, onChat }: Props) {
  SIZE = mascotSizeForLevel(level);
  const { visible, minimized, pos } = useMascotSettings();
  const reduced = useRef(prefersReducedMotion()).current;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [xy, setXy] = useState(() => toPx(pos));
  const [dragging, setDragging] = useState(false);
  const [bubble, setBubble] = useState<{ text: string; key: number } | null>(null);
  const [mood, setMood] = useState<MascotMood>('happy');
  const [pulse, setPulse] = useState(0); // re-triggers the tap animation
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);
  const [blink, setBlink] = useState(false);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const bubbleTimer = useRef<number | null>(null);
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const tapCount = useRef(0);
  const longPress = useRef<{ timer: number | null; fired: boolean }>({ timer: null, fired: false });
  const clearLongPress = () => { if (longPress.current.timer) { window.clearTimeout(longPress.current.timer); longPress.current.timer = null; } };
  useEffect(() => () => clearLongPress(), []);

  // keep position valid on resize / rotation
  useEffect(() => {
    const onResize = () => setXy(nudgeClear(toPx(pos).x, toPx(pos).y));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pos]);

  const say = useCallback((text: string, m: MascotMood = 'happy', ms = 4200) => {
    setBubble({ text, key: Date.now() });
    setMood(m);
    if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => { setBubble(null); setMood('happy'); }, ms);
  }, []);

  useEffect(() => () => { if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current); }, []);

  // app-wide events (level ups, chest claims, quests...)
  useEffect(() => onMascotMessage((m) => {
    say(m.text, m.mood, 4800);
    if (m.mood === 'hype') { burst(14); if (!reduced) setPulse((p) => p + 1); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [say]);

  // greeting + gentle daily-quest reminder
  const greeted = useRef(false);
  useEffect(() => {
    if (greeted.current || !visible || minimized) return;
    const t1 = window.setTimeout(() => { greeted.current = true; say(username ? `Yo ${username}! Ozone here. Ready to stack sparks?` : 'Yo! Ozone here. Ready to stack sparks?', 'wink'); }, 1200);
    return () => window.clearTimeout(t1);
  }, [visible, minimized, username, say]);
  useEffect(() => {
    if (!visible || minimized || suppressed) return;
    const t = window.setTimeout(() => {
      if (readyToClaim > 0) say(`You've got ${readyToClaim} quest reward${readyToClaim > 1 ? 's' : ''} ready to claim! 💎`, 'hype');
      else if (questsLeft > 0) say(`${questsLeft} daily quest${questsLeft > 1 ? 's' : ''} left today. Let's knock ${questsLeft > 1 ? 'them' : 'it'} out!`);
    }, 9000);
    return () => window.clearTimeout(t);
  }, [questsLeft, readyToClaim, visible, minimized, suppressed, say]);
  // occasional idle tip
  useEffect(() => {
    if (!visible || minimized || suppressed) return;
    const id = window.setInterval(() => { if (!document.hidden) say(pickLine(TIP_LINES), 'happy', 4600); }, 75000);
    return () => window.clearInterval(id);
  }, [visible, minimized, suppressed, say]);

  // blinking
  useEffect(() => {
    if (!visible || minimized) return;
    let t = 0;
    const loop = () => { t = window.setTimeout(() => { setBlink(true); window.setTimeout(() => setBlink(false), 140); loop(); }, 2400 + Math.random() * 3200); };
    loop();
    return () => window.clearTimeout(t);
  }, [visible, minimized]);

  // eyes follow pointer / finger
  useEffect(() => {
    if (!visible || minimized) return;
    let raf = 0; let px = 0; let py = 0;
    const update = () => {
      raf = 0;
      const el = rootRef.current; if (!el) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2; const cy = r.top + r.height * 0.42;
      const dx = px - cx; const dy = py - cy; const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 160);
      setLook({ x: (dx / d) * k, y: (dy / d) * k });
    };
    const onMove = (e: PointerEvent) => { px = e.clientX; py = e.clientY; if (!raf) raf = requestAnimationFrame(update); };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onMove, { passive: true });
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerdown', onMove); if (raf) cancelAnimationFrame(raf); };
  }, [visible, minimized]);

  const burst = (n = 10) => {
    const count = reduced ? Math.ceil(n / 3) : n;
    const base = Date.now();
    const list = Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      const s = 34 + Math.random() * 30;
      return { id: base + i, dx: Math.cos(a) * s, dy: Math.sin(a) * s - 10, c: SPARK_COLORS[i % SPARK_COLORS.length] };
    });
    setSparkles((prev) => [...prev, ...list].slice(-40));
    window.setTimeout(() => setSparkles((prev) => prev.filter((p) => p.id < base || p.id >= base + count)), 900);
  };

  const onTap = () => {
    tapCount.current += 1;
    setPulse((p) => p + 1);
    burst(10);
    haptic([8, 20, 8]);
    if (tapCount.current % 5 === 0) { sfx.mascot('squish'); say('Okay okay, I\'m awake! 😵‍💫', 'wink'); return; }
    sfx.mascot(tapCount.current % 2 ? 'happy' : 'boop');
    const tip = Math.random() < 0.45;
    say(tip ? pickLine(TIP_LINES) : pickLine(TAP_LINES), tip ? 'happy' : 'wink');
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: xy.x, oy: xy.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // long-press (~550ms without dragging) opens the chat; a normal tap keeps its reactions
    clearLongPress(); longPress.current.fired = false;
    if (onChat) longPress.current.timer = window.setTimeout(() => { longPress.current.timer = null; if (drag.current && !drag.current.moved) { longPress.current.fired = true; haptic([10, 40, 10]); sfx.mascot('happy'); setBubble(null); onChat(); } }, 550);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx; const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 7) return;
    if (!d.moved) { d.moved = true; setDragging(true); clearLongPress(); }
    const a = freeArea();
    setXy({ x: Math.min(a.maxX, Math.max(a.minX, d.ox + dx)), y: Math.min(window.innerHeight - SIZE - MARGIN, Math.max(a.minY, d.oy + dy)) });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    clearLongPress();
    if (longPress.current.fired) { longPress.current.fired = false; return; }
    if (!d.moved) { onTap(); return; }
    setDragging(false);
    const next = nudgeClear(xy.x, xy.y);
    setXy(next);
    setMascotPos(toFrac(next.x, next.y));
    sfx.mascot('boop');
  };
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); } };

  if (!visible || suppressed) return null;

  const onLeft = xy.x < window.innerWidth / 2;

  if (minimized) {
    return (
      <button className={`oz-mini ${onLeft ? 'left' : 'right'}`} style={{ top: Math.min(xy.y, window.innerHeight - 160) }} onClick={() => { setMascotMinimized(false); sfx.mascot('happy'); haptic(10); }} aria-label="Show Ozone">
        <span className="oz-mini-orb" />
      </button>
    );
  }

  const wink = mood === 'wink' && !!bubble;
  const hype = mood === 'hype' && !!bubble;
  const tilt = look.x * 6;

  return (
    <div
      ref={rootRef}
      className={`oz-root ${dragging ? 'dragging' : ''} ${reduced ? 'reduced' : ''}`}
      style={{ transform: `translate3d(${xy.x}px, ${xy.y}px, 0)`, width: SIZE, height: SIZE, transition: 'transform .45s var(--spring, ease), width .6s var(--spring, ease), height .6s var(--spring, ease)' }}
    >
      {bubble && (
        <div key={bubble.key} className={`oz-bubble ${onLeft ? 'left' : 'right'} ${xy.y < 190 ? 'below' : ''}`} role="status" aria-live="polite">{bubble.text}{onChat && <><br /><button type="button" className="oz-chat-chip" onClick={() => { sfx.tap(); setBubble(null); onChat(); }}><MessageCircle size={12} /> Chat</button></>}</div>
      )}
      {bubble && <button className="oz-hide" aria-label="Minimize Ozone" onClick={() => { setBubble(null); setMascotMinimized(true); }}><Minus size={12} /></button>}
      <div
        className="oz-hit"
        role="button"
        tabIndex={0}
        aria-label={onChat ? "Ozone, your field buddy. Tap for a tip, long-press to chat, drag to move." : "Ozone, your field buddy. Tap to chat, drag to move."}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; clearLongPress(); setDragging(false); }}
        onKeyDown={onKey}
      >
        <div className="oz-float">
          <div key={pulse} className={`oz-body ${pulse ? 'tapped' : ''} ${hype ? 'hype' : ''}`}>
            <OzoneSvg look={look} blink={blink} wink={wink} hype={hype} tilt={tilt} />
          </div>
        </div>
        <span className="oz-shadow" />
        {sparkles.map((s) => <i key={s.id} className="oz-spark" style={{ '--dx': `${s.dx}px`, '--dy': `${s.dy}px`, background: s.c } as React.CSSProperties} />)}
      </div>
    </div>
  );
}

/** Ozone, drawn after the field mascot: red + grey locs, brown skin, cyan circuit lines, beard,
 *  gold chain, black puffer with red/green trim, holding a glowing signal orb. */
function OzoneSvg({ look, blink, wink, hype, tilt }: { look: { x: number; y: number }; blink: boolean; wink: boolean; hype: boolean; tilt: number }) {
  const px = look.x * 2.6; const py = look.y * 2.2;
  return (
    <svg viewBox="0 0 120 130" width="100%" height="100%" aria-hidden="true">
      <defs>
        <radialGradient id="ozSkin" cx="45%" cy="38%" r="65%"><stop offset="0" stopColor="#b9774c" /><stop offset=".7" stopColor="#8c5434" /><stop offset="1" stopColor="#6e3f26" /></radialGradient>
        <linearGradient id="ozJacket" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3a3d44" /><stop offset="1" stopColor="#15171b" /></linearGradient>
        <radialGradient id="ozOrb" cx="40%" cy="35%" r="70%"><stop offset="0" stopColor="#ffffff" /><stop offset=".35" stopColor="var(--oz-orb)" /><stop offset="1" stopColor="var(--oz-orb-deep)" /></radialGradient>
        <filter id="ozGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" /></filter>
      </defs>

      {/* body: puffer jacket */}
      <g>
        <path d="M22 128 C20 104 34 92 60 92 C86 92 100 104 98 128 Z" fill="url(#ozJacket)" />
        <path d="M30 112 C44 108 76 108 90 112" stroke="#000" strokeOpacity=".35" strokeWidth="2" fill="none" />
        <path d="M27 122 C44 118 76 118 93 122" stroke="#000" strokeOpacity=".3" strokeWidth="2" fill="none" />
        <path d="M44 93 L60 112 L76 93" stroke="var(--oz-trim-a)" strokeWidth="3.4" fill="none" strokeLinejoin="round" />
        <path d="M47 92 L60 107 L73 92" stroke="var(--oz-trim-b)" strokeWidth="2.2" fill="none" strokeLinejoin="round" />
        <path d="M60 112 L60 128" stroke="#c9a24a" strokeWidth="1.4" />
        {/* gold chain */}
        <path d="M46 95 C48 108 72 108 74 95" stroke="#e8be55" strokeWidth="3" fill="none" strokeDasharray="3 1.6" strokeLinecap="round" />
      </g>

      {/* head group tilts toward the pointer */}
      <g style={{ transform: `rotate(${tilt}deg)`, transformOrigin: '60px 90px', transition: 'transform .25s ease-out' }}>
        {/* back locs */}
        <g strokeLinecap="round" fill="none" strokeWidth="7.5">
          <path d="M28 44 C20 62 22 82 26 96" stroke="#c23a3c" />
          <path d="M33 38 C26 58 30 80 34 92" stroke="#8f8b88" />
          <path d="M92 44 C100 62 98 82 94 96" stroke="#8f8b88" />
          <path d="M87 38 C94 58 90 80 86 92" stroke="#c23a3c" />
        </g>
        {/* ears + earring */}
        <ellipse cx="27" cy="62" rx="5" ry="7" fill="#7d4a2d" />
        <ellipse cx="93" cy="62" rx="5" ry="7" fill="#7d4a2d" />
        <circle cx="93.5" cy="70" r="1.8" fill="#f1c75a" />
        {/* face */}
        <ellipse cx="60" cy="60" rx="33" ry="35" fill="url(#ozSkin)" />
        {/* circuit lines */}
        <g stroke="var(--oz-orb)" strokeWidth="1.1" fill="none" opacity=".85" strokeLinecap="round">
          <path d="M38 40 L38 48 L43 52" /><circle cx="43.5" cy="52.5" r="1.2" fill="var(--oz-orb)" />
          <path d="M82 40 L82 48 L77 52" /><circle cx="76.5" cy="52.5" r="1.2" fill="var(--oz-orb)" />
          <path d="M33 62 L36 68 L35 74" /><path d="M87 62 L84 68 L85 74" />
        </g>
        {/* top locs / hair cap */}
        <path d="M26 50 C24 26 44 14 60 14 C76 14 96 26 94 50 C88 36 76 30 60 30 C44 30 32 36 26 50 Z" fill="#7f7b78" />
        <g strokeLinecap="round" fill="none" strokeWidth="7">
          <path d="M34 34 C40 22 50 18 58 18" stroke="#c23a3c" />
          <path d="M62 18 C72 18 82 24 87 34" stroke="#c23a3c" />
          <path d="M44 30 C50 24 56 22 60 22" stroke="#9c9895" />
          <path d="M60 22 C66 22 72 25 76 30" stroke="#9c9895" />
          <path d="M28 46 C26 38 30 30 36 26" stroke="#a83133" />
          <path d="M92 46 C94 38 90 30 84 26" stroke="#8f8b88" />
        </g>
        {/* brows */}
        <path d={hype ? 'M40 47 Q47 41 54 46' : 'M40 49 Q47 45 54 48'} stroke="#2a1a12" strokeWidth="3.6" strokeLinecap="round" fill="none" />
        <path d={wink ? 'M66 49 Q73 47 80 50' : hype ? 'M66 46 Q73 41 80 47' : 'M66 48 Q73 45 80 49'} stroke="#2a1a12" strokeWidth="3.6" strokeLinecap="round" fill="none" />
        {/* eyes */}
        <g style={{ transform: blink ? 'scaleY(.08)' : 'none', transformOrigin: '60px 59px', transition: 'transform .07s' }}>
          <ellipse cx="47" cy="59" rx="6.4" ry="7" fill="#fff" />
          <circle cx={47 + px} cy={59.5 + py} r="3.9" fill="#3b2216" />
          <circle cx={47 + px} cy={59.5 + py} r="2" fill="#120a06" />
          <circle cx={45.6 + px} cy={57.8 + py} r="1.2" fill="#fff" />
          {wink ? (
            <path d="M67 60 Q73 64 79 60" stroke="#2a1a12" strokeWidth="2.6" strokeLinecap="round" fill="none" />
          ) : (
            <>
              <ellipse cx="73" cy="59" rx="6.4" ry="7" fill="#fff" />
              <circle cx={73 + px} cy={59.5 + py} r="3.9" fill="#3b2216" />
              <circle cx={73 + px} cy={59.5 + py} r="2" fill="#120a06" />
              <circle cx={71.6 + px} cy={57.8 + py} r="1.2" fill="#fff" />
            </>
          )}
        </g>
        {/* nose */}
        <path d="M57 66 Q60 71 63 66" stroke="#5e341f" strokeWidth="2" strokeLinecap="round" fill="none" />
        {/* beard + mustache */}
        <path d="M30 66 C30 86 44 98 60 98 C76 98 90 86 90 66 C86 78 78 82 60 82 C42 82 34 78 30 66 Z" fill="#241712" />
        <path d="M46 75 C52 71 68 71 74 75 C68 74 52 74 46 75 Z" fill="#241712" stroke="#241712" strokeWidth="3" strokeLinejoin="round" />
        {/* smile */}
        <path d={hype ? 'M50 79 Q60 90 70 79 Z' : 'M51 80 Q60 86 69 80 Z'} fill="#fff" stroke="#5a2b1c" strokeWidth="1" />
        {/* cheeks */}
        <ellipse cx="38" cy="70" rx="4" ry="2.4" fill="var(--oz-blush)" opacity=".45" />
        <ellipse cx="82" cy="70" rx="4" ry="2.4" fill="var(--oz-blush)" opacity=".45" />
      </g>

      {/* hand + signal orb */}
      <g className="oz-orb-g">
        <circle cx="17" cy="104" r="11" fill="var(--oz-orb)" opacity=".55" filter="url(#ozGlow)" />
        <circle cx="17" cy="104" r="8" fill="url(#ozOrb)" />
        <circle cx="17" cy="104" r="11" fill="none" stroke="var(--oz-orb)" strokeWidth="1.2" strokeDasharray="5 4" className="oz-orb-ring" />
        <ellipse cx="18" cy="116" rx="7" ry="4.5" fill="#8c5434" />
      </g>
    </svg>
  );
}
