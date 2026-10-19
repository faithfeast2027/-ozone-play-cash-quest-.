import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Star, Sparkles, Trophy, RotateCcw, Crosshair, Building2 } from 'lucide-react';
import { creditSparks, fetchWallet, getOrCreatePlayerId } from '@/lib/supabase';
import type { Character } from '@/components/SparkRunGame';

type Props = {
  character: Character;
  onClose: () => void;
  onWalletUpdate?: () => void;
};

type TargetKind = 'star' | 'block' | 'gold';
type Target = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: TargetKind;
  size: number;
  hp: number;
  rot: number;
};

type Shot = { id: number; x: number; y: number };
type Burst = { id: number; x: number; y: number; color: string };

const GAME_W = 100;
const GAME_H = 100;
const SHOOTER_Y = 88;
const FIRE_COOLDOWN = 180;

const SPAWN_BASE = 900;

export default function NYCStarCrush({ character, onClose, onWalletUpdate }: Props) {
  const [running, setRunning] = useState(true);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [lives, setLives] = useState(3);
  const [starsHit, setStarsHit] = useState(0);
  const [blocksHit, setBlocksHit] = useState(0);
  const [wave, setWave] = useState(1);
  const [gameOver, setGameOver] = useState(false);
  const [bestScore, setBestScore] = useState(() => {
    const s = localStorage.getItem('nyc_star_best');
    return s ? parseInt(s, 10) : 0;
  });
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [mode, setMode] = useState('STAR CRUSH');

  const targetsRef = useRef<Target[]>([]);
  const shotsRef = useRef<Shot[]>([]);
  const aimRef = useRef(50);
  const lastFireRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const livesRef = useRef(3);
  const starsRef = useRef(0);
  const blocksRef = useRef(0);
  const waveRef = useRef(1);
  const spawnEveryRef = useRef(SPAWN_BASE);
  const idRef = useRef(0);
  const collectedRef = useRef(false);
  const playerIdRef = useRef(getOrCreatePlayerId());
  const isFiringRef = useRef(false);

  const spawnTarget = useCallback((waveNum: number) => {
    const id = idRef.current++;
    const roll = Math.random();
    let kind: TargetKind = 'star';
    if (roll < 0.15) kind = 'gold';
    else if (roll < 0.45) kind = 'block';

    const x = 8 + Math.random() * 84;
    const vy = 0.18 + Math.random() * 0.12 + waveNum * 0.015;
    const vx = (Math.random() - 0.5) * 0.25;
    const size = kind === 'block' ? 6 : kind === 'gold' ? 4.5 : 4;
    const hp = kind === 'block' ? 2 : 1;

    targetsRef.current = [...targetsRef.current, { id, x, y: -6, vx, vy, kind, size, hp, rot: Math.random() * 360 }];
  }, []);

  const fire = useCallback(() => {
    const now = performance.now();
    if (now - lastFireRef.current < FIRE_COOLDOWN) return;
    lastFireRef.current = now;
    const id = idRef.current++;
    shotsRef.current = [...shotsRef.current, { id, x: aimRef.current, y: SHOOTER_Y - 4 }];
  }, []);

  const burst = (x: number, y: number, color: string) => {
    const id = idRef.current++;
    setBursts((b) => [...b.slice(-10), { id, x, y, color }]);
    setTimeout(() => setBursts((b) => b.filter((p) => p.id !== id)), 420);
  };

  const endGame = useCallback(() => {
    setRunning(false);
    setGameOver(true);
    const finalScore = scoreRef.current;
    setScore(finalScore);
    if (finalScore > bestScore) {
      setBestScore(finalScore);
      localStorage.setItem('nyc_star_best', String(finalScore));
    }
    if (!collectedRef.current && finalScore > 0) {
      collectedRef.current = true;
      const sparks = Math.floor(finalScore / 12) + starsRef.current * 2;
      creditSparks(playerIdRef.current, sparks, 'nyc_star_crush', character.id)
        .then(() => { fetchWallet(playerIdRef.current).then(() => onWalletUpdate?.()); })
        .catch(() => {});
    }
  }, [bestScore, character.id, onWalletUpdate]);

  useEffect(() => {
    if (!running) return;
    const tick = (now: number) => {
      if (now - lastSpawnRef.current > spawnEveryRef.current) {
        lastSpawnRef.current = now;
        spawnTarget(waveRef.current);
        if (waveRef.current > 2 && Math.random() < 0.3) spawnTarget(waveRef.current);
      }

      if (isFiringRef.current) fire();

      shotsRef.current = shotsRef.current
        .map((s) => ({ ...s, y: s.y - 3 }))
        .filter((s) => s.y > -4);

      targetsRef.current = targetsRef.current
        .map((t) => ({ ...t, x: Math.max(2, Math.min(96, t.x + t.vx)), y: t.y + t.vy, rot: t.rot + 1.5 }))
        .filter((t) => t.y < GAME_H + 6);

      const remainingShots: Shot[] = [];
      const hitIds = new Set<number>();
      for (const shot of shotsRef.current) {
        let consumed = false;
        for (const t of targetsRef.current) {
          if (hitIds.has(t.id)) continue;
          const dx = Math.abs(t.x - shot.x);
          const dy = Math.abs(t.y - shot.y);
          if (dx < t.size + 1.5 && dy < t.size + 1.5) {
            t.hp -= 1;
            hitIds.add(t.id);
            consumed = true;
            if (t.hp <= 0) {
              const points = t.kind === 'gold' ? 50 : t.kind === 'block' ? 25 : 15;
              const comboBonus = Math.floor(comboRef.current / 5) * 5;
              scoreRef.current += points + comboBonus;
              comboRef.current += 1;
              if (t.kind === 'star' || t.kind === 'gold') starsRef.current += 1;
              if (t.kind === 'block') blocksRef.current += 1;
              const color = t.kind === 'gold' ? '#e8d083' : t.kind === 'block' ? '#8bd1d4' : '#b9f17b';
              burst(t.x, t.y, color);
              setScore(scoreRef.current);
              setCombo(comboRef.current);
              setStarsHit(starsRef.current);
              setBlocksHit(blocksRef.current);
              if (comboRef.current > 0 && comboRef.current % 12 === 0) {
                setMode(comboRef.current % 24 === 0 ? 'MANHATTAN FEVER' : 'STAR STORM');
              }
            } else {
              burst(t.x, t.y, '#ffffff');
            }
            break;
          }
        }
        if (!consumed) remainingShots.push(shot);
      }
      shotsRef.current = remainingShots;
      targetsRef.current = targetsRef.current.filter((t) => !hitIds.has(t.id) || t.hp > 0);

      for (const t of targetsRef.current) {
        if (t.y > GAME_H - 4) {
          livesRef.current -= 1;
          setLives(livesRef.current);
          comboRef.current = 0;
          setCombo(0);
          burst(t.x, GAME_H - 2, '#e58a69');
          targetsRef.current = targetsRef.current.filter((x) => x.id !== t.id);
          if (livesRef.current <= 0) { endGame(); return; }
        }
      }

      const newWave = 1 + Math.floor(scoreRef.current / 300);
      if (newWave !== waveRef.current) {
        waveRef.current = newWave;
        setWave(newWave);
        spawnEveryRef.current = Math.max(420, SPAWN_BASE - newWave * 70);
      }

      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [running, fire, spawnTarget, endGame]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!running) return;
      if (e.key === 'ArrowLeft' || e.key === 'a') aimRef.current = Math.max(4, aimRef.current - 6);
      if (e.key === 'ArrowRight' || e.key === 'd') aimRef.current = Math.min(96, aimRef.current + 6);
      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w') { e.preventDefault(); fire(); }
    };
    const handleDown = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w') isFiringRef.current = true;
    };
    const handleUp = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w') isFiringRef.current = false;
    };
    window.addEventListener('keydown', handleKey);
    window.addEventListener('keydown', handleDown);
    window.addEventListener('keyup', handleUp);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('keydown', handleDown);
      window.removeEventListener('keyup', handleUp);
    };
  }, [running, fire]);

  const handlePointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    aimRef.current = Math.max(4, Math.min(96, px));
  };

  const restart = () => {
    targetsRef.current = [];
    shotsRef.current = [];
    scoreRef.current = 0;
    comboRef.current = 0;
    livesRef.current = 3;
    starsRef.current = 0;
    blocksRef.current = 0;
    waveRef.current = 1;
    spawnEveryRef.current = SPAWN_BASE;
    collectedRef.current = false;
    lastSpawnRef.current = 0;
    lastFireRef.current = 0;
    aimRef.current = 50;
    setScore(0); setCombo(0); setLives(3); setStarsHit(0); setBlocksHit(0); setWave(1);
    setMode('STAR CRUSH');
    setGameOver(false);
    setRunning(true);
  };

  const earnedSparks = Math.floor(score / 12) + starsHit * 2;
  const displayTargets = targetsRef.current;
  const displayShots = shotsRef.current;

  return (
    <div className="modal-backdrop">
      <div className="game-modal arcade-game nyc-modal">
        <button className="modal-close" onClick={onClose}><X size={17} /></button>
        <div className="game-header">
          <div>
            <p className="eyebrow">NYC SKIES / {character.name.toUpperCase()}</p>
            <h2>NYC Star Crush</h2>
          </div>
          <span className="timer nyc-mode">{mode}</span>
        </div>

        <div className="nyc-arena" onPointerMove={handlePointer} onPointerDown={(e) => { handlePointer(e); isFiringRef.current = true; fire(); }} onPointerUp={() => { isFiringRef.current = false; }} onPointerLeave={() => { isFiringRef.current = false; }}>
          <div className="nyc-skyline">
            <Building2 size={13} className="b1" />
            <Building2 size={18} className="b2" />
            <Building2 size={11} className="b3" />
            <Building2 size={22} className="b4" />
            <Building2 size={15} className="b5" />
            <Building2 size={9} className="b6" />
            <Building2 size={19} className="b7" />
            <Building2 size={12} className="b8" />
          </div>

          {displayShots.map((s) => (
            <span key={s.id} className="nyc-shot" style={{ left: `${s.x}%`, top: `${s.y}%` }} />
          ))}

          {displayTargets.map((t) => (
            <div
              key={t.id}
              className={`nyc-target kind-${t.kind}`}
              style={{ left: `${t.x}%`, top: `${t.y}%`, width: `${t.size * 2}%`, height: `${t.size * 2}%`, transform: `translate(-50%, -50%) rotate(${t.rot}deg)` }}
            />
          ))}

          {bursts.map((p) => (
            <span key={p.id} className="nyc-burst" style={{ left: `${p.x}%`, top: `${p.y}%`, background: p.color }} />
          ))}

          <div className="nyc-shooter" style={{ left: `${aimRef.current}%` }}>
            <img src={character.image} alt={character.name} />
            <span className="crosshair"><Crosshair size={14} /></span>
          </div>

          <div className="nyc-hud">
            <span className="lives">
              {Array.from({ length: 3 }).map((_, i) => (
                <Star key={i} size={12} className={i < lives ? 'on' : ''} />
              ))}
            </span>
            <span className="wave">Wave {wave}</span>
          </div>
        </div>

        <div className="run-stats">
          <span><Sparkles size={14} /> Score <strong>{score}</strong></span>
          <span><Star size={14} /> Stars <strong>{starsHit}</strong></span>
          <span><Building2 size={14} /> Blocks <strong>{blocksHit}</strong></span>
          <span><Trophy size={14} /> Combo <strong>{combo}x</strong></span>
        </div>

        <div className="lane-controls">
          <button onClick={() => { aimRef.current = Math.max(4, aimRef.current - 8); }} disabled={!running}>◀ Aim left</button>
          <button onClick={() => fire()} disabled={!running} className="fire-btn">Fire ★</button>
          <button onClick={() => { aimRef.current = Math.min(96, aimRef.current + 8); }} disabled={!running}>Aim right ▶</button>
        </div>

        {gameOver && (
          <div className="run-gameover">
            <strong>Star Crush complete</strong>
            <p>Score <b>{score}</b> · Best <b>{bestScore}</b></p>
            <p className="earned-note"><Sparkles size={13} /> Earned {earnedSparks} sparks · added to your wallet</p>
            <div className="run-gameover-actions">
              <button className="primary-button" onClick={restart}><RotateCcw size={15} /> Play again</button>
              <button className="boost-button" onClick={onClose}>Close</button>
            </div>
          </div>
        )}
        <small className="game-footnote">Move with arrows / mouse · Space or Fire button to shoot · don&apos;t let stars reach the skyline</small>
      </div>
    </div>
  );
}
