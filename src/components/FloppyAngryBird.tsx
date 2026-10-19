import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Sparkles, Trophy, RotateCcw, Bird, Target, Flame } from 'lucide-react';
import { creditSparks, fetchWallet, getOrCreatePlayerId } from '@/lib/supabase';
import type { Character } from '@/components/SparkRunGame';

type Props = {
  character: Character;
  onClose: () => void;
  onWalletUpdate?: () => void;
};

type Pipe = { id: number; x: number; gapY: number; scored: boolean };
type Pig = { id: number; x: number; y: number; hp: number };
type Particle = { id: number; x: number; y: number; color: string };

const ARENA_H = 100;
const BIRD_X = 22;
const BIRD_SIZE = 5;
const PIPE_W = 10;
const GAP_SIZE = 24;
const GRAVITY = 0.42;
const FLAP_V = -7.5;
const BASE_SPEED = 2.4;

export default function FloppyAngryBird({ character, onClose, onWalletUpdate }: Props) {
  const [running, setRunning] = useState(true);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [pigsHit, setPigsHit] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [mode, setMode] = useState('FLOPPY LAUNCH');
  const [particles, setParticles] = useState<Particle[]>([]);
  const [bestScore, setBestScore] = useState(() => {
    const s = localStorage.getItem('floppy_angry_best');
    return s ? parseInt(s, 10) : 0;
  });

  const birdYRef = useRef(50);
  const velYRef = useRef(0);
  const rotRef = useRef(0);
  const pipesRef = useRef<Pipe[]>([]);
  const pigsRef = useRef<Pig[]>([]);
  const speedRef = useRef(BASE_SPEED);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const pigsRef2 = useRef(0);
  const lastSpawnRef = useRef(0);
  const idRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const collectedRef = useRef(false);
  const playerIdRef = useRef(getOrCreatePlayerId());

  const burst = (x: number, y: number, color: string) => {
    const id = idRef.current++;
    setParticles((prev) => [...prev.slice(-12), { id, x, y, color }]);
    setTimeout(() => setParticles((prev) => prev.filter((p) => p.id !== id)), 400);
  };

  const flap = useCallback(() => {
    if (!running) return;
    velYRef.current = FLAP_V;
    rotRef.current = -30;
  }, [running]);

  const endGame = useCallback(() => {
    setRunning(false);
    setGameOver(true);
    const finalScore = scoreRef.current;
    setScore(finalScore);
    if (finalScore > bestScore) {
      setBestScore(finalScore);
      localStorage.setItem('floppy_angry_best', String(finalScore));
    }
    if (!collectedRef.current && finalScore > 0) {
      collectedRef.current = true;
      const sparks = Math.floor(finalScore / 8) + pigsRef2.current * 3;
      creditSparks(playerIdRef.current, sparks, 'floppy_angry_bird', character.id)
        .then(() => { fetchWallet(playerIdRef.current).then(() => onWalletUpdate?.()); })
        .catch(() => {});
    }
  }, [bestScore, character.id, onWalletUpdate]);

  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const speed = speedRef.current;

      velYRef.current += GRAVITY;
      birdYRef.current += velYRef.current;
      rotRef.current = Math.max(-30, Math.min(90, velYRef.current * 6));

      if (birdYRef.current < 2) { birdYRef.current = 2; velYRef.current = 0; }
      if (birdYRef.current > ARENA_H - 3) { burst(BIRD_X, ARENA_H - 2, '#e58a69'); endGame(); return; }

      if (performance.now() - lastSpawnRef.current > 1800) {
        lastSpawnRef.current = performance.now();
        const gapY = 25 + Math.random() * 40;
        pipesRef.current = [...pipesRef.current, { id: idRef.current++, x: 105, gapY, scored: false }];
        if (Math.random() < 0.5) {
          pigsRef.current = [...pigsRef.current, { id: idRef.current++, x: 108, y: gapY + GAP_SIZE / 2 + (Math.random() - 0.5) * 10, hp: 1 }];
        }
      }

      pipesRef.current = pipesRef.current
        .map((p) => ({ ...p, x: p.x - speed }))
        .filter((p) => p.x > -PIPE_W - 5);

      pigsRef.current = pigsRef.current
        .map((p) => ({ ...p, x: p.x - speed }))
        .filter((p) => p.x > -8);

      for (const pipe of pipesRef.current) {
        const dx = Math.abs(pipe.x - BIRD_X);
        if (dx < PIPE_W / 2 + BIRD_SIZE / 2) {
          const inGap = birdYRef.current > pipe.gapY && birdYRef.current < pipe.gapY + GAP_SIZE;
          if (!inGap) { burst(BIRD_X, birdYRef.current, '#e58a69'); endGame(); return; }
        }
        if (!pipe.scored && pipe.x < BIRD_X) {
          pipe.scored = true;
          scoreRef.current += 15;
          comboRef.current += 1;
          setScore(scoreRef.current);
          setCombo(comboRef.current);
          burst(BIRD_X + 6, pipe.gapY + GAP_SIZE / 2, '#b9f17b');
          if (comboRef.current > 0 && comboRef.current % 5 === 0) {
            setMode(comboRef.current % 10 === 0 ? 'ANGRY FRENZY' : 'BIRD BLITZ');
            speedRef.current = Math.min(speedRef.current * 1.08, BASE_SPEED * 2.2);
          }
        }
      }

      pigsRef.current = pigsRef.current.filter((pig) => {
        const dx = Math.abs(pig.x - BIRD_X);
        const dy = Math.abs(pig.y - birdYRef.current);
        if (dx < BIRD_SIZE && dy < BIRD_SIZE) {
          pigsRef2.current += 1;
          scoreRef.current += 25;
          setPigsHit(pigsRef2.current);
          setScore(scoreRef.current);
          burst(pig.x, pig.y, '#b9f17b');
          return false;
        }
        return true;
      });

      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [running, endGame]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!running) return;
      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w') { e.preventDefault(); flap(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [running, flap]);

  const restart = () => {
    birdYRef.current = 50;
    velYRef.current = 0;
    rotRef.current = 0;
    pipesRef.current = [];
    pigsRef.current = [];
    speedRef.current = BASE_SPEED;
    scoreRef.current = 0;
    comboRef.current = 0;
    pigsRef2.current = 0;
    collectedRef.current = false;
    lastSpawnRef.current = 0;
    setScore(0); setCombo(0); setPigsHit(0);
    setMode('FLOPPY LAUNCH');
    setGameOver(false);
    setRunning(true);
  };

  const earnedSparks = Math.floor(score / 8) + pigsHit * 3;

  return (
    <div className="modal-backdrop">
      <div className="game-modal arcade-game floppy-modal">
        <button className="modal-close" onClick={onClose}><X size={17} /></button>
        <div className="game-header">
          <div>
            <p className="eyebrow">LAUNCH ARCADE / {character.name.toUpperCase()}</p>
            <h2>Floppy Angry Bird</h2>
          </div>
          <span className="timer floppy-mode">{mode}</span>
        </div>

        <div className="floppy-arena" onPointerDown={flap}>
          <div className="floppy-sky" />
          <div className="floppy-clouds" />
          <div className="floppy-hills" />

          {pipesRef.current.map((pipe) => (
            <div key={pipe.id} className="floppy-pipe" style={{ left: `${pipe.x}%` }}>
              <div className="pipe-top" style={{ height: `${pipe.gapY}%` }} />
              <div className="pipe-gap" style={{ height: `${GAP_SIZE}%` }} />
              <div className="pipe-bottom" style={{ height: `${ARENA_H - pipe.gapY - GAP_SIZE}%` }} />
            </div>
          ))}

          {pigsRef.current.map((pig) => (
            <div key={pig.id} className="floppy-pig" style={{ left: `${pig.x}%`, top: `${pig.y}%` }} />
          ))}

          <div className="floppy-bird" style={{ left: `${BIRD_X}%`, top: `${birdYRef.current}%`, transform: `translate(-50%, -50%) rotate(${rotRef.current}deg)` }}>
            <img src={character.image} alt={character.name} />
          </div>

          {particles.map((p) => (
            <span key={p.id} className="run-particle" style={{ left: `${p.x}%`, top: `${p.y}%`, background: p.color }} />
          ))}

          <div className="floppy-score-hud">
            <span><Target size={14} /> {score}</span>
            <span><Flame size={14} /> {combo}x</span>
          </div>
        </div>

        <div className="run-stats">
          <span><Sparkles size={14} /> Score <strong>{score}</strong></span>
          <span><Bird size={14} /> Pigs <strong>{pigsHit}</strong></span>
          <span><Trophy size={14} /> Combo <strong>{combo}x</strong></span>
        </div>

        <div className="lane-controls">
          <button onClick={flap} disabled={!running} className="flap-btn"><Bird size={15} /> Flap / Launch</button>
          <button onClick={() => {}} disabled className="hint-btn">Space / Tap arena</button>
        </div>

        {gameOver && (
          <div className="run-gameover">
            <strong>Launch complete</strong>
            <p>Score <b>{score}</b> · Best <b>{bestScore}</b></p>
            <p className="earned-note"><Sparkles size={13} /> Earned {earnedSparks} sparks · added to your wallet</p>
            <div className="run-gameover-actions">
              <button className="primary-button" onClick={restart}><RotateCcw size={15} /> Launch again</button>
              <button className="boost-button" onClick={onClose}>Close</button>
            </div>
          </div>
        )}
        <small className="game-footnote">Tap the arena, press space, or hit Flap to launch upward · fly through pipe gaps · smash green pigs for bonus points</small>
      </div>
    </div>
  );
}
