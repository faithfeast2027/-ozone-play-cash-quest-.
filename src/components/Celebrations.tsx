import { useEffect, useRef, useState } from 'react';
import { Sparkles, Gift, Loader2, Star } from 'lucide-react';
import { fitCanvas, prefersReducedMotion, startLoop } from '@/lib/juice';
import { sfx, haptic } from '@/lib/sfx';
import { levelReward, CHEST_REWARD } from '@/lib/progress';

const COLORS = ['#b9f17b', '#8bd1d4', '#ffd34d', '#ff8f6b', '#c98ad4', '#ffffff'];

/** Full-screen canvas confetti + light particles. Static sparkle field when reduced motion is on. */
export function Confetti({ density = 160 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const reduced = prefersReducedMotion();
    let stage = fitCanvas(canvas);
    const onResize = () => { stage = fitCanvas(canvas); };
    window.addEventListener('resize', onResize);
    type C = { x: number; y: number; vx: number; vy: number; r: number; vr: number; w: number; h: number; c: string; life: number };
    const bits: C[] = [];
    const spawn = (n: number) => {
      for (let i = 0; i < n; i++) {
        const fromLeft = i % 2 === 0;
        bits.push({ x: fromLeft ? -10 : stage.w + 10, y: stage.h * (0.55 + Math.random() * 0.25), vx: (fromLeft ? 1 : -1) * (220 + Math.random() * 380), vy: -(500 + Math.random() * 520), r: Math.random() * 6, vr: (Math.random() - 0.5) * 12, w: 6 + Math.random() * 6, h: 9 + Math.random() * 8, c: COLORS[i % COLORS.length], life: 3 + Math.random() * 1.5 });
      }
    };
    if (reduced) {
      const { ctx, w, h } = stage;
      for (let i = 0; i < 40; i++) { ctx.fillStyle = COLORS[i % COLORS.length]; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 3, 0, Math.PI * 2); ctx.fill(); }
      return () => window.removeEventListener('resize', onResize);
    }
    spawn(density);
    let t = 0;
    const stop = startLoop((dt) => {
      t += dt;
      if (t > 0.5 && t < 0.56) spawn(Math.round(density / 2));
      const { ctx, w, h } = stage;
      ctx.clearRect(0, 0, w, h);
      for (const b of bits) {
        b.life -= dt; b.vy += 900 * dt; b.vx *= 0.99; b.vy *= 0.985; b.x += b.vx * dt; b.y += b.vy * dt; b.r += b.vr * dt;
        ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, b.life)); ctx.translate(b.x, b.y); ctx.rotate(b.r);
        ctx.scale(1, Math.cos(b.r * 2)); ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
      }
      for (let i = bits.length - 1; i >= 0; i--) if (bits[i].life <= 0 || bits[i].y > h + 40) bits.splice(i, 1);
      return t < 6;
    });
    return () => { stop(); window.removeEventListener('resize', onResize); };
  }, [density]);
  return <canvas ref={ref} className="confetti-canvas" aria-hidden="true" />;
}

type ClaimFn = () => Promise<boolean>;

function useClaim(claim: ClaimFn) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [err, setErr] = useState('');
  const run = async () => {
    if (state === 'busy' || state === 'done') return;
    setState('busy'); setErr('');
    try { const ok = await claim(); setState(ok ? 'done' : 'idle'); if (ok) { sfx.claim(); haptic([10, 40, 10]); } }
    catch (e) { setState('error'); setErr(e instanceof Error ? e.message : 'Could not add sparks.'); }
  };
  return { state, err, run };
}

export function LevelUpOverlay({ level, rewardLevel, onClaim, onClose }: { level: number; rewardLevel?: number; onClaim: ClaimFn; onClose: () => void }) {
  const { state, err, run } = useClaim(onClaim);
  useEffect(() => { sfx.levelUp(); haptic([20, 60, 20, 60, 40]); }, [level]);
  return (
    <div className="celebrate-backdrop" onClick={state === 'done' ? onClose : undefined}>
      <Confetti />
      <div className="celebrate-card" onClick={(e) => e.stopPropagation()}>
        <div className="celebrate-burst" />
        <p className="celebrate-eyebrow">LEVEL UP</p>
        <div className="level-medal"><span>{level}</span></div>
        <h2>You reached level {level}!</h2>
        <p className="celebrate-sub">Every run, quest, and win pushes you higher.</p>
        {state === 'done' || !rewardLevel ? (
          <button className="arcade-cta" onClick={onClose}>Keep playing</button>
        ) : (
          <button className="arcade-cta" onClick={run} disabled={state === 'busy'}>
            {state === 'busy' ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />} Collect +{levelReward(rewardLevel)} sparks
          </button>
        )}
        {err && <p className="celebrate-err">{err}</p>}
        {state !== 'done' && rewardLevel && <button className="arcade-ghost" onClick={onClose}>Later</button>}
        <small className="arcade-over-note">Bonus sparks are non-cashable play sparks.</small>
      </div>
    </div>
  );
}

export function ChestOverlay({ onClaim, onClose }: { onClaim: ClaimFn; onClose: () => void }) {
  const { state, err, run } = useClaim(onClaim);
  const [opened, setOpened] = useState(false);
  const open = async () => { setOpened(true); sfx.win(); haptic([15, 40, 15]); await run(); };
  return (
    <div className="celebrate-backdrop">
      {opened && <Confetti density={200} />}
      <div className="celebrate-card" onClick={(e) => e.stopPropagation()}>
        <div className="celebrate-burst" />
        <p className="celebrate-eyebrow">ALL DAILY QUESTS DONE</p>
        <button className={`quest-chest ${opened ? 'open' : ''}`} onClick={open} disabled={opened && state !== 'error'} aria-label="Open bonus chest">
          <span className="chest-lid" /><span className="chest-body"><Gift size={30} /></span>
          {opened && <span className="chest-rays" />}
        </button>
        <h2>{opened ? (state === 'done' ? `+${CHEST_REWARD} bonus sparks!` : 'Opening…') : 'Bonus chest unlocked'}</h2>
        <p className="celebrate-sub">{opened ? 'New quests arrive at midnight.' : 'Tap the chest to open it.'}</p>
        {err && <><p className="celebrate-err">{err}</p><button className="arcade-cta" onClick={run}><Star size={16} /> Try again</button></>}
        {state === 'done' ? <button className="arcade-cta" onClick={onClose}>Nice!</button> : <button className="arcade-ghost" onClick={onClose}>Later</button>}
      </div>
    </div>
  );
}

/** Level badge with an SVG XP ring. */
export function LevelRing({ level, into, need, size = 40 }: { level: number; into: number; need: number; size?: number }) {
  const r = size / 2 - 3; const c = 2 * Math.PI * r; const pct = Math.max(0, Math.min(1, into / need));
  return (
    <span className="level-ring" style={{ width: size, height: size }} title={`Level ${level} · ${into}/${need} XP`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs><linearGradient id="xpgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#b9f17b" /><stop offset="1" stopColor="#8bd1d4" /></linearGradient></defs>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.12)" strokeWidth="4" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke="url(#xpgrad)" strokeWidth="4" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset .8s cubic-bezier(.2,.9,.3,1.2)' }} />
      </svg>
      <b>{level}</b>
    </span>
  );
}
