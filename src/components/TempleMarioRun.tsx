import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Sparkles, Trophy, RotateCcw, Coins, Flame, ArrowUp } from 'lucide-react';
import { creditSparks, fetchWallet, getOrCreatePlayerId } from '@/lib/supabase';
import type { Character } from '@/components/SparkRunGame';

type Props = {
  character: Character;
  onClose: () => void;
  onWalletUpdate?: () => void;
};

type Obstacle = { id: number; x: number; kind: 'spike' | 'block' | 'gap' };
type Platform = { id: number; x: number; y: number; w: number };
type Coin = { id: number; x: number; y: number };
type Particle = { id: number; x: number; y: number; color: string };

const GROUND_Y = 82;
const GRAVITY = 0.55;
const JUMP_V = -11;
const PLAYER_X = 14;
const BASE_SPEED = 3.2;
const COIN_VALUE = 10;

export default function TempleMarioRun({ character, onClose, onWalletUpdate }: Props) {
  const [running, setRunning] = useState(true);
  const [score, setScore] = useState(0);
  const [coins, setCoins] = useState(0);
  const [combo, setCombo] = useState(0);
  const [distance, setDistance] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [mode, setMode] = useState('TEMPLE RUN');
  const [particles, setParticles] = useState<Particle[]>([]);
  const [bestScore, setBestScore] = useState(() => {
    const s = localStorage.getItem('temple_mario_best');
    return s ? parseInt(s, 10) : 0;
  });

  const posYRef = useRef(GROUND_Y);
  const velYRef = useRef(0);
  const onGroundRef = useRef(true);
  const obstaclesRef = useRef<Obstacle[]>([]);
  const platformsRef = useRef<Platform[]>([]);
  const coinsRef = useRef<Coin[]>([]);
  const speedRef = useRef(BASE_SPEED * character.speed);
  const distRef = useRef(0);
  const scoreRef = useRef(0);
  const coinsRef2 = useRef(0);
  const comboRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const lastEventRef = useRef(0);
  const idRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const collectedRef = useRef(false);
  const playerIdRef = useRef(getOrCreatePlayerId());
  const renderRef = useRef(0);

  const burst = (x: number, y: number, color: string) => {
    const id = idRef.current++;
    setParticles((prev) => [...prev.slice(-10), { id, x, y, color }]);
    setTimeout(() => setParticles((prev) => prev.filter((p) => p.id !== id)), 420);
  };

  const jump = useCallback(() => {
    if (!running || !onGroundRef.current) return;
    velYRef.current = JUMP_V;
    onGroundRef.current = false;
  }, [running]);

  const endGame = useCallback(() => {
    setRunning(false);
    setGameOver(true);
    const finalScore = Math.floor(scoreRef.current);
    setScore(finalScore);
    if (finalScore > bestScore) {
      setBestScore(finalScore);
      localStorage.setItem('temple_mario_best', String(finalScore));
    }
    if (!collectedRef.current && coinsRef2.current > 0) {
      collectedRef.current = true;
      const sparks = coinsRef2.current + Math.floor(finalScore / 25);
      creditSparks(playerIdRef.current, sparks, 'temple_mario_run', character.id)
        .then(() => { fetchWallet(playerIdRef.current).then(() => onWalletUpdate?.()); })
        .catch(() => {});
    }
  }, [bestScore, character.id, onWalletUpdate]);

  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const speed = speedRef.current;
      distRef.current += speed * 0.05;
      scoreRef.current += speed * 0.08;
      setDistance(Math.floor(distRef.current));
      setScore(Math.floor(scoreRef.current));

      velYRef.current += GRAVITY;
      posYRef.current += velYRef.current;
      if (posYRef.current >= GROUND_Y) {
        posYRef.current = GROUND_Y;
        velYRef.current = 0;
        onGroundRef.current = true;
      }

      for (const p of platformsRef.current) {
        const px = p.x;
        const pRight = p.x + p.w;
        if (PLAYER_X + 4 > px && PLAYER_X + 4 < pRight) {
          const feet = posYRef.current + 2;
          if (velYRef.current >= 0 && feet > p.y - 4 && feet < p.y + 6) {
            posYRef.current = p.y - 2;
            velYRef.current = 0;
            onGroundRef.current = true;
          }
        }
      }

      if (performance.now() - lastSpawnRef.current > Math.max(700, 1100 - distRef.current * 0.3)) {
        lastSpawnRef.current = performance.now();
        const roll = Math.random();
        const spawnX = 110;
        if (roll < 0.35) {
          obstaclesRef.current = [...obstaclesRef.current, { id: idRef.current++, x: spawnX, kind: 'spike' }];
        } else if (roll < 0.55) {
          obstaclesRef.current = [...obstaclesRef.current, { id: idRef.current++, x: spawnX, kind: 'block' }];
        } else if (roll < 0.75) {
          const py = 58 + Math.random() * 12;
          platformsRef.current = [...platformsRef.current, { id: idRef.current++, x: spawnX, y: py, w: 16 + Math.random() * 10 }];
          for (let c = 0; c < 3; c++) {
            coinsRef.current = [...coinsRef.current, { id: idRef.current++, x: spawnX + 4 + c * 5, y: py - 8 }];
          }
        } else {
          for (let c = 0; c < 4; c++) {
            coinsRef.current = [...coinsRef.current, { id: idRef.current++, x: spawnX + c * 5, y: 70 + Math.sin(c) * 8 }];
          }
        }
      }

      obstaclesRef.current = obstaclesRef.current
        .map((o) => ({ ...o, x: o.x - speed }))
        .filter((o) => o.x > -8);
      platformsRef.current = platformsRef.current
        .map((p) => ({ ...p, x: p.x - speed }))
        .filter((p) => p.x + p.w > -8);
      coinsRef.current = coinsRef.current
        .map((c) => ({ ...c, x: c.x - speed }))
        .filter((c) => c.x > -8);

      coinsRef.current = coinsRef.current.filter((c) => {
        const dx = Math.abs(c.x - (PLAYER_X + 2));
        const dy = Math.abs(c.y - posYRef.current);
        if (dx < 5 && dy < 8) {
          coinsRef2.current += 1;
          comboRef.current += 1;
          scoreRef.current += COIN_VALUE;
          setCoins(coinsRef2.current);
          setCombo(comboRef.current);
          setScore(Math.floor(scoreRef.current));
          burst(c.x, c.y, '#e8d083');
          if (comboRef.current > 0 && comboRef.current % 10 === 0) {
            setMode(comboRef.current % 20 === 0 ? 'COIN FRENZY' : 'TEMPLE SURGE');
          }
          return false;
        }
        return true;
      });

      for (const o of obstaclesRef.current) {
        const dx = Math.abs(o.x - (PLAYER_X + 2));
        if (dx < 4) {
          if (o.kind === 'spike' && posYRef.current > GROUND_Y - 6) {
            burst(PLAYER_X, GROUND_Y, '#e58a69');
            endGame();
            return;
          }
          if (o.kind === 'block' && posYRef.current > GROUND_Y - 10) {
            burst(PLAYER_X, GROUND_Y - 6, '#e58a69');
            endGame();
            return;
          }
        }
      }

      if (performance.now() - lastEventRef.current > 25000) {
        lastEventRef.current = performance.now();
        const events = ['TEMPLE SURGE', 'COIN FRENZY', 'SPEED RUSH'];
        setMode(events[Math.floor(Math.random() * events.length)]);
        speedRef.current = Math.min(speedRef.current * 1.12, BASE_SPEED * character.speed * 2.4);
      }

      renderRef.current++;
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [running, character.speed, endGame]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!running) return;
      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w') { e.preventDefault(); jump(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [running, jump]);

  const restart = () => {
    obstaclesRef.current = [];
    platformsRef.current = [];
    coinsRef.current = [];
    posYRef.current = GROUND_Y;
    velYRef.current = 0;
    onGroundRef.current = true;
    distRef.current = 0;
    scoreRef.current = 0;
    coinsRef2.current = 0;
    comboRef.current = 0;
    speedRef.current = BASE_SPEED * character.speed;
    collectedRef.current = false;
    lastSpawnRef.current = 0;
    lastEventRef.current = 0;
    setScore(0); setCoins(0); setCombo(0); setDistance(0);
    setMode('TEMPLE RUN');
    setGameOver(false);
    setRunning(true);
  };

  const earnedSparks = coins + Math.floor(score / 25);

  return (
    <div className="modal-backdrop">
      <div className="game-modal arcade-game temple-modal">
        <button className="modal-close" onClick={onClose}><X size={17} /></button>
        <div className="game-header">
          <div>
            <p className="eyebrow">TEMPLE RUN / {character.name.toUpperCase()}</p>
            <h2>Temple Mario Run</h2>
          </div>
          <span className="timer temple-mode">{mode}</span>
        </div>

        <div className="temple-arena">
          <div className="temple-bg-far" />
          <div className="temple-bg-mid" />
          <div className="temple-ground" />

          {platformsRef.current.map((p) => (
            <div key={p.id} className="temple-platform" style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%` }} />
          ))}

          {coinsRef.current.map((c) => (
            <span key={c.id} className="temple-coin" style={{ left: `${c.x}%`, top: `${c.y}%` }}>◆</span>
          ))}

          {obstaclesRef.current.map((o) => (
            <span key={o.id} className={`temple-obstacle kind-${o.kind}`} style={{ left: `${o.x}%`, top: `${GROUND_Y - (o.kind === 'block' ? 8 : 0)}%` }}>
              {o.kind === 'spike' ? '▲' : '■'}
            </span>
          ))}

          <div className="temple-player" style={{ left: `${PLAYER_X}%`, top: `${posYRef.current}%`, transform: `translate(-50%, -100%)` }}>
            <img src={character.image} alt={character.name} />
          </div>

          {particles.map((p) => (
            <span key={p.id} className="run-particle" style={{ left: `${p.x}%`, top: `${p.y}%`, background: p.color }} />
          ))}

          <div className="temple-speed-bar"><i style={{ width: `${Math.min((speedRef.current / (BASE_SPEED * character.speed * 2.4)) * 100, 100)}%` }} /></div>
        </div>

        <div className="run-stats">
          <span><Sparkles size={14} /> Score <strong>{score}</strong></span>
          <span><Coins size={14} /> Coins <strong>{coins}</strong></span>
          <span><Flame size={14} /> Combo <strong>{combo}x</strong></span>
          <span><Trophy size={14} /> Dist <strong>{distance}m</strong></span>
        </div>

        <div className="lane-controls">
          <button onClick={jump} disabled={!running} className="jump-btn"><ArrowUp size={15} /> Jump</button>
          <button onClick={() => {}} disabled className="hint-btn">Space / Tap to jump</button>
        </div>

        {gameOver && (
          <div className="run-gameover">
            <strong>Run complete</strong>
            <p>Score <b>{score}</b> · Best <b>{bestScore}</b></p>
            <p className="earned-note"><Sparkles size={13} /> Earned {earnedSparks} sparks · added to your wallet</p>
            <div className="run-gameover-actions">
              <button className="primary-button" onClick={restart}><RotateCcw size={15} /> Run again</button>
              <button className="boost-button" onClick={onClose}>Close</button>
            </div>
          </div>
        )}
        <small className="game-footnote">Press space, tap, or hit Jump to leap · land on platforms · dodge spikes and blocks · coins earn sparks</small>
      </div>
    </div>
  );
}
