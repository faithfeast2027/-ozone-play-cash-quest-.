import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X, Play, RotateCcw, Trophy, Sparkles, Zap, Crown, Volume2, VolumeX } from 'lucide-react';
import { easeOutCubic, prefersReducedMotion } from '@/lib/juice';
import { sfx, useSfxOn, setSfxOn } from '@/lib/sfx';

export type RunResult = {
  score: number;
  best: number;
  isBest: boolean;
  xp: number;
  sparks: number;
  level: number;
  leveledUp: boolean;
  headline?: string;
  sub?: string;
  win?: boolean;
};

export type Phase = 'ready' | 'playing' | 'over';

type Props = {
  theme: string; // accent class: spark | temple | floppy | nyc | mancala | drunk
  eyebrow: string;
  title: string;
  mode?: string;
  phase: Phase;
  hud?: ReactNode;
  children: ReactNode;
  controls?: ReactNode;
  howTo: string;
  best?: number;
  result?: RunResult | null;
  onStart: () => void;
  onRestart: () => void;
  onClose: () => void;
  footnote?: string;
  startLabel?: string;
  againLabel?: string;
  icon?: ReactNode;
};

export function CountUp({ value, duration = 1100 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(prefersReducedMotion() ? value : 0);
  const lastTick = useRef(0);
  useEffect(() => {
    if (prefersReducedMotion()) { setShown(value); return; }
    let raf = 0; const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const v = Math.round(easeOutCubic(t) * value);
      setShown(v);
      if (now - lastTick.current > 60 && t < 1) { lastTick.current = now; sfx.tick(); }
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{shown.toLocaleString()}</>;
}

export function SfxToggle({ className = '' }: { className?: string }) {
  const on = useSfxOn();
  return (
    <button className={`sfx-toggle ${className}`} aria-label={on ? 'Mute game sounds' : 'Unmute game sounds'} title={on ? 'Game sounds on' : 'Game sounds off'} onClick={() => { setSfxOn(!on); if (!on) setTimeout(() => sfx.tap(), 0); }}>
      {on ? <Volume2 size={16} /> : <VolumeX size={16} />}
    </button>
  );
}

export default function GameShell({ theme, eyebrow, title, mode, phase, hud, children, controls, howTo, best = 0, result, onStart, onRestart, onClose, footnote, startLabel = 'Play', againLabel = 'Play again', icon }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if ((e.key === 'Enter' || e.key === ' ') && phase === 'ready') { e.preventDefault(); onStart(); }
      if (e.key === 'Enter' && phase === 'over') { e.preventDefault(); onRestart(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onStart, onRestart, onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div className="modal-backdrop arcade-backdrop">
      <div className={`arcade-shell arc-${theme}`} role="dialog" aria-label={title}>
        <div className="arcade-shell-glow" />
        <header className="arcade-head">
          <div className="arcade-title">
            <span className="arcade-icon">{icon}</span>
            <div><p>{eyebrow}</p><h2>{title}</h2></div>
          </div>
          <div className="arcade-head-actions">
            <SfxToggle />
            <button className="arcade-close" onClick={onClose} aria-label="Close game"><X size={18} /></button>
          </div>
        </header>
        <div className="arcade-hud">{hud}{mode && <span className="arcade-mode" key={mode}>{mode}</span>}</div>
        <div className="arcade-stage">
          {children}
          {phase === 'ready' && (
            <div className="arcade-ready">
              <div className="arcade-ready-card">
                <span className="arcade-ready-icon">{icon}</span>
                <h3>{title}</h3>
                <p>{howTo}</p>
                {best > 0 && <span className="arcade-best-chip"><Trophy size={13} /> Best {best.toLocaleString()}</span>}
                <button className="arcade-cta" onClick={() => { sfx.start(); onStart(); }}><Play size={18} fill="currentColor" /> {startLabel}</button>
              </div>
            </div>
          )}
        </div>
        {controls && <div className="arcade-controls">{controls}</div>}
        {footnote && <small className="arcade-foot">{footnote}</small>}

        {phase === 'over' && result && (
          <div className="arcade-over">
            <div className="arcade-over-card">
              <p className="arcade-over-eyebrow">{result.headline ?? 'Run complete'}</p>
              {result.isBest && <span className="arcade-newbest"><Crown size={14} /> New best!</span>}
              <div className="arcade-bigscore"><CountUp value={result.score} /></div>
              {result.sub && <p className="arcade-over-sub">{result.sub}</p>}
              <div className="arcade-over-stats">
                <span><Trophy size={15} /><small>Best</small><b>{result.best.toLocaleString()}</b></span>
                <span><Zap size={15} /><small>XP</small><b>+<CountUp value={result.xp} duration={900} /></b></span>
                <span><Sparkles size={15} /><small>Sparks</small><b>+{result.sparks}</b></span>
              </div>
              {result.leveledUp && <p className="arcade-over-level">Level {result.level} reached!</p>}
              <div className="arcade-over-actions">
                <button className="arcade-cta" onClick={() => { sfx.start(); onRestart(); }}><RotateCcw size={17} /> {againLabel}</button>
                <button className="arcade-ghost" onClick={onClose}>Back to hub</button>
              </div>
              <small className="arcade-over-note">Arcade sparks are for play and unlocks, not cash-out.</small>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
