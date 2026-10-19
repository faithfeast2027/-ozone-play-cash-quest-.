import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Zap, Sparkles, Trophy, RotateCcw } from 'lucide-react';
import { creditSparks, fetchWallet, getOrCreatePlayerId } from '@/lib/supabase';

export type Character = {
  id: string;
  name: string;
  image: string;
  cost: number;
  perk: string;
  speed: number;
};

type GameProps = {
  character: Character;
  onClose: () => void;
  onWalletUpdate?: () => void;
};

type Obstacle = { x: number; lane: number; kind: 'block' | 'gap' };
type Coin = { x: number; lane: number };
type Particle = { id: number; x: number; y: number; color: string };

const LANES = [22, 50, 78];
const BASE_SPEED = 4.2;
const SPAWN_EVERY = 780;

export default function SparkRunGame({ character, onClose, onWalletUpdate }: GameProps) {
  const [running, setRunning] = useState(true);
  const [lane, setLane] = useState(1);
  const [coins, setCoins] = useState(0);
  const [distance, setDistance] = useState(0);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [combo, setCombo] = useState(0);
  const [mode, setMode] = useState('SPARK RUN');
  const [particles, setParticles] = useState<Particle[]>([]);
  const [bestScore, setBestScore] = useState(() => {
    const stored = localStorage.getItem('ozone_best_score');
    return stored ? parseInt(stored, 10) : 0;
  });

  const obstaclesRef = useRef<Obstacle[]>([]);
  const coinListRef = useRef<Coin[]>([]);
  const laneRef = useRef(1);
  const speedRef = useRef(BASE_SPEED * character.speed);
  const frameRef = useRef<number | null>(null);
  const lastSpawnRef = useRef(0);
  const lastEventRef = useRef(0);
  const particleIdRef = useRef(0);
  const distanceRef = useRef(0);
  const comboRef = useRef(0);
  const coinsRef = useRef(0);
  const playerIdRef = useRef(getOrCreatePlayerId());
  const collectedRef = useRef(false);

  useEffect(() => { laneRef.current = lane; }, [lane]);

  const endGame = useCallback(() => {
    setRunning(false);
    setGameOver(true);
    const finalScore = Math.floor(distanceRef.current * 2 + coinsRef.current * 10 + comboRef.current * 5);
    setScore(finalScore);
    if (finalScore > bestScore) {
      setBestScore(finalScore);
      localStorage.setItem('ozone_best_score', String(finalScore));
    }
    if (!collectedRef.current && coinsRef.current > 0) {
      collectedRef.current = true;
      creditSparks(playerIdRef.current, coinsRef.current, 'spark_run_game', character.id)
        .then(() => {
          fetchWallet(playerIdRef.current).then(() => onWalletUpdate?.());
        })
        .catch(() => {});
    }
  }, [bestScore, character.id, onWalletUpdate]);

  const burst = (x: number, y: number, color: string) => {
    const id = particleIdRef.current++;
    setParticles((prev) => [...prev.slice(-12), { id, x, y, color }]);
    setTimeout(() => setParticles((prev) => prev.filter((p) => p.id !== id)), 480);
  };

  useEffect(() => {
    if (!running) return;
    const tick = (now: number) => {
      const speed = speedRef.current;
      distanceRef.current += speed * 0.02;
      setDistance(Math.floor(distanceRef.current));

      if (now - lastSpawnRef.current > SPAWN_EVERY) {
        lastSpawnRef.current = now;
        const laneIdx = Math.floor(Math.random() * 3);
        const isCoin = Math.random() < 0.55;
        if (isCoin) {
          coinListRef.current = [...coinListRef.current.slice(-4), { x: 100, lane: laneIdx }];
        } else {
          obstaclesRef.current = [...obstaclesRef.current.slice(-3), { x: 100, lane: laneIdx, kind: 'block' }];
        }
      }

      coinListRef.current = coinListRef.current
        .map((c) => ({ ...c, x: c.x - speed * 0.9 }))
        .filter((c) => c.x > -8);

      obstaclesRef.current = obstaclesRef.current
        .map((o) => ({ ...o, x: o.x - speed * 0.9 }))
        .filter((o) => o.x > -8);

      const playerLane = laneRef.current;
      const playerX = 12;

      coinListRef.current = coinListRef.current.filter((c) => {
        if (c.lane === playerLane && Math.abs(c.x - playerX) < 8) {
          coinsRef.current += 1;
          comboRef.current += 1;
          setCoins(coinsRef.current);
          setCombo(comboRef.current);
          burst(LANES[playerLane], 70, '#b9f17b');
          if (comboRef.current % 10 === 0) setMode(comboRef.current % 20 === 0 ? 'ULTRA RUSH' : 'FEVER COINS');
          return false;
        }
        return true;
      });

      for (const o of obstaclesRef.current) {
        if (o.lane === playerLane && Math.abs(o.x - playerX) < 7) {
          burst(LANES[playerLane], 70, '#e58a69');
          comboRef.current = 0;
          setCombo(0);
          endGame();
          return;
        }
      }

      if (now - lastEventRef.current > 30000) {
        lastEventRef.current = now;
        const events = ['COIN STORM', 'SPEED SURGE', 'BOSS DODGE'];
        setMode(events[Math.floor(Math.random() * events.length)]);
        speedRef.current = Math.min(speedRef.current * 1.12, BASE_SPEED * character.speed * 2.2);
      }

      setCoins(coinsRef.current);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [running, character.speed, endGame]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!running) return;
      if (e.key === 'ArrowLeft' || e.key === 'a') setLane((l) => Math.max(0, l - 1));
      if (e.key === 'ArrowRight' || e.key === 'd') setLane((l) => Math.min(2, l + 1));
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [running]);

  const restart = () => {
    obstaclesRef.current = [];
    coinListRef.current = [];
    distanceRef.current = 0;
    comboRef.current = 0;
    coinsRef.current = 0;
    speedRef.current = BASE_SPEED * character.speed;
    collectedRef.current = false;
    lastSpawnRef.current = 0;
    lastEventRef.current = 0;
    setLane(1);
    setCoins(0);
    setDistance(0);
    setCombo(0);
    setMode('SPARK RUN');
    setGameOver(false);
    setRunning(true);
  };

  return (
    <div className="modal-backdrop">
      <div className="game-modal arcade-game">
        <button className="modal-close" onClick={onClose}><X size={17} /></button>
        <div className="game-header">
          <div>
            <p className="eyebrow">ARCADE RUN / {character.name.toUpperCase()}</p>
            <h2>Spark Run</h2>
          </div>
          <span className="timer">{mode}</span>
        </div>

        <div className="run-track">
          <div className="run-lane-stripes" />
          {[...obstaclesRef.current, ...coinListRef.current].map((item, i) => {
            const isObstacle = 'kind' in item;
            return (
              <div
                key={i}
                className={isObstacle ? 'run-obstacle' : 'run-coin'}
                style={{ left: `${item.x}%`, top: `${20 + item.lane * 22}%` }}
              >
                {isObstacle ? '█' : '◆'}
              </div>
            );
          })}
          <div className="run-player" style={{ left: '12%', top: `${20 + lane * 22}%` }}>
            <img src={character.image} alt={character.name} />
          </div>
          {particles.map((p) => (
            <span key={p.id} className="run-particle" style={{ left: `${p.x}%`, top: `${p.y}%`, background: p.color }} />
          ))}
          <div className="run-speed-bar"><i style={{ width: `${Math.min((speedRef.current / (BASE_SPEED * character.speed * 2.2)) * 100, 100)}%` }} /></div>
        </div>

        <div className="run-stats">
          <span><Sparkles size={14} /> Coins <strong>{coins}</strong></span>
          <span><Zap size={14} /> Combo <strong>{combo}x</strong></span>
          <span><Trophy size={14} /> Dist <strong>{distance}m</strong></span>
        </div>

        <div className="lane-controls">
          <button onClick={() => setLane((l) => Math.max(0, l - 1))} disabled={!running}>◀ Lane left</button>
          <button onClick={() => setLane((l) => Math.min(2, l + 1))} disabled={!running}>Lane right ▶</button>
        </div>

        {gameOver && (
          <div className="run-gameover">
            <strong>Run complete</strong>
            <p>Score <b>{score}</b> · Best <b>{bestScore}</b></p>
            <p className="earned-note">Earned {coins} sparks · added to your wallet</p>
            <div className="run-gameover-actions">
              <button className="primary-button" onClick={restart}><RotateCcw size={15} /> Run again</button>
              <button className="boost-button" onClick={onClose}>Close</button>
            </div>
          </div>
        )}
        <small className="game-footnote">Use arrow keys or the lane buttons · coins earn real sparks</small>
      </div>
    </div>
  );
}
