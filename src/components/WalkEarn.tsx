import { useEffect, useRef, useState } from 'react';
import {
  X,
  Footprints,
  Sparkles,
  Play,
  Square,
  Lock,
  Crown,
  RotateCcw,
  TrendingUp,
  Clock,
} from 'lucide-react';
import {
  fetchActiveWalkSession,
  fetchWalkHistory,
  supabase,
  fetchSubscription,
  fetchWallet,
  getOrCreatePlayerId,
  openBillingPortal,
  startSubscriptionCheckout,
  startWalkSession,
  updateWalkSession,
  type Subscription,
  type WalkSession,
} from '@/lib/supabase';

const STEPS_PER_METER = 1.35;
const STEPS_PER_SPARK = 100;
const TIERS = [
  { id: 'walk', name: 'Walk', price: '$7.99', day: 150, cash: 6 },
  { id: 'stride', name: 'Stride', price: '$14.99', day: 250, cash: 12 },
  { id: 'marathon', name: 'Marathon', price: '$24.99', day: 400, cash: 20 },
] as const;
type TierId = (typeof TIERS)[number]['id'];
const MAX_SPEED_MS = 3.4;

type Props = {
  onClose: () => void;
  onWalletUpdate?: () => void;
};

export default function WalkEarn({ onClose, onWalletUpdate }: Props) {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<WalkSession | null>(null);
  const [steps, setSteps] = useState(0);
  const [distanceM, setDistanceM] = useState(0);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'searching' | 'tracking' | 'denied'>('idle');
  const [history, setHistory] = useState<WalkSession[]>([]);

  const watchIdRef = useRef<number | null>(null);
  const lastPosRef = useRef<{ lat: number; lon: number; t: number } | null>(null);
  const stepsRef = useRef(0);
  const distRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const playerIdRef = useRef(getOrCreatePlayerId());

  const isMember = subscription?.status === 'active';
  const myTier = TIERS.find((t) => t.id === subscription?.plan) ?? TIERS[0];
  const DAILY_WALK_CAP = myTier.day;

  useEffect(() => {
    (async () => {
      try {
        const [sub, active] = await Promise.all([fetchSubscription(), fetchActiveWalkSession()]);
        setSubscription(sub);
        if (active) {
          setSession(active);
          sessionIdRef.current = active.id;
          stepsRef.current = active.steps;
          distRef.current = active.distance_m;
          setSteps(active.steps);
          setDistanceM(active.distance_m);
        }
      } catch (err) {
        setError('Could not load your membership.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const stopGps = () => {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setGpsStatus('idle');
  };

  useEffect(() => () => stopGps(), []);

  const beginWalk = async () => {
    setError(null);
    if (!navigator.geolocation) {
      setError('Location is not available on this device.');
      return;
    }
    setGpsStatus('searching');
    if (!session) {
      try {
        const newSession = await startWalkSession();
        setSession(newSession);
        sessionIdRef.current = newSession.id;
      } catch {
        setError('Could not start a walk session.');
        setGpsStatus('idle');
        return;
      }
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsStatus('tracking');
        const { latitude, longitude } = pos.coords;
        const last = lastPosRef.current;
        if (last) {
          const d = haversine(last.lat, last.lon, latitude, longitude);
          const dt = Math.max((pos.timestamp - last.t) / 1000, 0.5);
          if (d > 1 && d < 200 && d / dt <= MAX_SPEED_MS) {
            distRef.current += d;
            stepsRef.current += Math.round(d * STEPS_PER_METER);
            setDistanceM(Math.round(distRef.current));
            setSteps(stepsRef.current);
            if (sessionIdRef.current) {
              updateWalkSession(sessionIdRef.current, stepsRef.current, Math.round(distRef.current)).catch(() => {});
            }
          }
        }
        lastPosRef.current = { lat: latitude, lon: longitude, t: pos.timestamp };
      },
      () => {
        setGpsStatus('denied');
        setError('Location permission denied. Enable it to track your walk.');
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
  };

  const finishWalk = async () => {
    stopGps();
    if (sessionIdRef.current) {
      try {
        const { data, error: bankErr } = await supabase.rpc('bank_walk', { p_session: sessionIdRef.current, p_player_id: playerIdRef.current });
        if (bankErr) throw bankErr;
        const r = data as { sparks: number; today: number; cap: number };
        if (r.sparks > 0) { await fetchWallet(playerIdRef.current); onWalletUpdate?.(); }
        else if (r.today >= r.cap) setError(`Daily walk limit reached (${r.cap} sparks). Come back tomorrow!`);
        fetchWalkHistory().then(setHistory).catch(() => {});
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save your walk.');
      }
    }
    setSession(null);
    sessionIdRef.current = null;
    stepsRef.current = 0;
    distRef.current = 0;
    lastPosRef.current = null;
    setSteps(0);
    setDistanceM(0);
    fetchActiveWalkSession().then(() => {}).catch(() => {});
  };

  const handleSubscribe = async (tier: TierId = 'walk') => {
    setError(null);
    setSubscribing(true);
    try {
      const url = await startSubscriptionCheckout(tier);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Subscription setup failed.');
    } finally {
      setSubscribing(false);
    }
  };

  const handlePortal = async () => {
    try {
      const url = await openBillingPortal();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open billing portal.');
    }
  };

  const distanceKm = (distanceM / 1000).toFixed(2);
  const sparksEarned = Math.min(Math.floor(steps / STEPS_PER_SPARK), DAILY_WALK_CAP);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="store-modal walk-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={17} /></button>
        <p className="eyebrow">MEMBERSHIP / WALK & EARN</p>
        <h2>Walk to earn sparks.</h2>
        <p className="store-subtitle">Members earn 1 spark per 100 steps at walking or jogging speed, and sparks bank when you finish. Higher plans earn more per day and cash out more each month.</p>

        {error && <div className="checkout-error">{error}</div>}

        {loading ? (
          <div className="walk-loading">Checking your membership…</div>
        ) : !isMember ? (
          <div className="walk-gate">
            <div className="gate-card">
              <Crown size={26} />
              <strong>Walk & Earn is a members-only feature</strong>
              <p>Pick a plan. Earn more, cash out more. Cancel anytime.</p>
              <div style={{ display: 'grid', gap: 8, width: '100%' }}>
                {TIERS.map((t) => (
                  <button key={t.id} className={t.id === 'stride' ? 'primary-button full' : 'full'} onClick={() => handleSubscribe(t.id)} disabled={subscribing} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '12px 14px' }}>
                    <span style={{ textAlign: 'left' }}><b>{t.name} · {t.price}/mo</b><br /><small>{t.day} walk sparks/day · cash out up to ${t.cash}/mo</small></span>
                    {subscribing ? <span>…</span> : <Sparkles size={15} />}
                  </button>
                ))}
              </div>
              <small>Billing handled securely by Stripe. Manage your plan anytime from this screen.</small>
            </div>
          </div>
        ) : (
          <div className="walk-active">
            <div className="walk-stat-grid">
              <div className="walk-stat">
                <Footprints size={18} />
                <strong>{steps.toLocaleString()}</strong>
                <small>steps</small>
              </div>
              <div className="walk-stat">
                <TrendingUp size={18} />
                <strong>{distanceKm} km</strong>
                <small>distance</small>
              </div>
              <div className="walk-stat accent">
                <Sparkles size={18} />
                <strong>{sparksEarned.toLocaleString()}</strong>
                <small>sparks earned</small>
              </div>
            </div>

            <div className={`gps-status gps-${gpsStatus}`}>
              <span className="gps-dot" />
              {gpsStatus === 'idle' && 'GPS ready'}
              {gpsStatus === 'searching' && 'Locking on to your position…'}
              {gpsStatus === 'tracking' && 'Live tracking active'}
              {gpsStatus === 'denied' && 'Location permission denied'}
            </div>

            {session ? (
              <div className="walk-controls">
                <button className="primary-button full" onClick={finishWalk}>
                  <Square size={15} /> Finish walk · bank {sparksEarned} sparks
                </button>
                {gpsStatus !== 'tracking' && gpsStatus !== 'searching' && (
                  <button className="boost-button" onClick={beginWalk}><Play size={15} /> Resume tracking</button>
                )}
              </div>
            ) : (
              <div className="walk-controls">
                <button className="primary-button full" onClick={beginWalk}>
                  <Play size={15} /> Start a walk
                </button>
              </div>
            )}

            {session && (
              <p className="walk-tip">
                <Clock size={12} /> Started {new Date(session.started_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · keep this screen open while you move.
              </p>
            )}

            <div className="walk-history">
              <strong>Recent walks</strong>
              {history.length === 0 ? (
                <p>No completed walks yet. Your first walk will appear here.</p>
              ) : (
                history.map((h) => (
                  <div key={h.id} className="walk-history-row">
                    <Footprints size={14} />
                    <span>{h.steps.toLocaleString()} steps</span>
                    <span>{(h.distance_m / 1000).toFixed(2)} km</span>
                    <span className="history-sparks"><Sparkles size={11} /> {h.sparks_earned}</span>
                  </div>
                ))
              )}
            </div>

            <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
              <small>Your plan: <b>{myTier.name}</b> · {myTier.day} walk sparks/day · cash out up to ${myTier.cash}/mo</small>
              {TIERS.filter((t) => t.day > myTier.day).map((t) => (
                <button key={t.id} onClick={() => { if (confirm(`Switch to ${t.name} for ${t.price}/mo? Stripe prorates the difference.`)) handleSubscribe(t.id); }} disabled={subscribing}>
                  Upgrade to {t.name} · {t.price}/mo ({t.day}/day, ${t.cash}/mo cash)
                </button>
              ))}
            </div>
            <button className="portal-link" onClick={handlePortal}>
              <RotateCcw size={13} /> Manage your subscription
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
