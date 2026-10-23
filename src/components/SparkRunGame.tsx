import { useCallback, useEffect, useRef, useState } from 'react';
import { Zap, Sparkles, Trophy, ChevronUp, ChevronDown, Gamepad2 } from 'lucide-react';
import { creditSparks, fetchWallet, getOrCreatePlayerId } from '@/lib/supabase';
import GameShell, { type Phase, type RunResult } from '@/components/GameShell';
import { Particles, Popups, Shake, fitCanvas, startLoop, loadImage, drawAvatar, drawGem, roundRect, lerp, prefersReducedMotion } from '@/lib/juice';
import { sfx, haptic } from '@/lib/sfx';
import { reportGameResult } from '@/lib/progress';

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

type Item = { x: number; lane: number; kind: 'coin' | 'block'; t: number };

const BASE_SPEED = 0.62; // screen widths per second
const BEST_KEY = 'ozone_best_score';

export default function SparkRunGame({ character, onClose, onWalletUpdate }: GameProps) {
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, setHud] = useState({ coins: 0, combo: 0, dist: 0 });
  const [mode, setMode] = useState('SPARK RUN');
  const [result, setResult] = useState<RunResult | null>(null);
  const [runId, setRunId] = useState(0);
  const [best, setBest] = useState(() => parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const laneRef = useRef(1);
  const phaseRef = useRef<Phase>('ready');
  const playerIdRef = useRef(getOrCreatePlayerId());
  phaseRef.current = phase;

  const move = useCallback((d: number) => {
    if (phaseRef.current !== 'playing') return;
    const next = Math.max(0, Math.min(2, laneRef.current + d));
    if (next !== laneRef.current) { laneRef.current = next; sfx.whoosh(); haptic(6); }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowUp', 'a', 'w'].includes(e.key)) { e.preventDefault(); move(-1); }
      if (['ArrowRight', 'ArrowDown', 'd', 's'].includes(e.key)) { e.preventDefault(); move(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move]);

  // Idle / attract-mode render + the game loop.
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const img = loadImage(character.image);
    const reduced = prefersReducedMotion();
    const parts = new Particles(); const pops = new Popups(); const shake = new Shake();
    const playing = phase === 'playing';
    let items: Item[] = [];
    let speed = BASE_SPEED * character.speed;
    let dist = 0; let coins = 0; let combo = 0; let maxCombo = 0;
    let spawnT = 0; let eventT = 0; let hudT = 0; let time = 0; let scroll = 0;
    let playerY = -1; let dying = 0; let ended = false; let flash = 0;
    laneRef.current = 1;
    const stars = Array.from({ length: 60 }, () => ({ x: Math.random(), y: Math.random() * 0.26, s: Math.random() * 1.6 + 0.3, p: Math.random() * 6 }));
    const towers = Array.from({ length: 14 }, (_, i) => ({ x: i / 14, h: 0.06 + Math.random() * 0.16, w: 0.05 + Math.random() * 0.05 }));

    const finish = () => {
      if (ended) return; ended = true;
      const score = Math.floor(dist * 2 + coins * 10);
      const prevBest = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
      const isBest = score > prevBest;
      if (isBest) { localStorage.setItem(BEST_KEY, String(score)); setBest(score); }
      if (coins > 0) {
        creditSparks(playerIdRef.current, coins, 'spark_run_game', character.id)
          .then(() => { fetchWallet(playerIdRef.current).then(() => onWalletUpdate?.()); })
          .catch(() => {});
      }
      const rep = reportGameResult('spark_run', score);
      sfx.over();
      setResult({ score, best: Math.max(score, prevBest), isBest, xp: rep.xpGained, sparks: Math.min(coins, 120), level: rep.level, leveledUp: rep.leveledUp, headline: 'Run complete', sub: `${coins} coins · ${Math.floor(dist)}m · best combo ${maxCombo}x` });
      setPhase('over');
    };

    let stage = fitCanvas(canvas);
    const onResize = () => { stage = fitCanvas(canvas); };
    window.addEventListener('resize', onResize);

    const stop = startLoop((rawDt) => {
      const { ctx, w, h } = stage;
      const dt = dying ? rawDt * 0.25 : rawDt;
      time += rawDt;
      const trackTop = h * 0.3; const laneH = (h * 0.62) / 3;
      const laneY = (l: number) => trackTop + laneH * (l + 0.5);
      const px = w * 0.16; const pr = Math.min(laneH * 0.33, 30);
      const targetY = laneY(laneRef.current);
      playerY = playerY < 0 ? targetY : lerp(playerY, targetY, 1 - Math.pow(0.0005, rawDt));

      if (playing && !dying) {
        dist += (speed / BASE_SPEED) * 5 * dt;
        spawnT -= dt; eventT += dt;
        if (spawnT <= 0) {
          spawnT = Math.max(0.42, 0.78 - dist / 2500);
          const lane = Math.floor(Math.random() * 3);
          if (Math.random() < 0.55) {
            const n = Math.random() < 0.35 ? 3 : 1;
            for (let i = 0; i < n; i++) items.push({ x: w + 30 + i * pr * 2.4, lane, kind: 'coin', t: Math.random() * 6 });
          } else items.push({ x: w + 40, lane, kind: 'block', t: 0 });
        }
        if (eventT > 30) {
          eventT = 0;
          const ev = ['COIN STORM', 'SPEED SURGE', 'BOSS DODGE'];
          setMode(ev[Math.floor(Math.random() * ev.length)]);
          speed = Math.min(speed * 1.12, BASE_SPEED * character.speed * 2.2);
          sfx.combo(5);
        }
      }
      const vx = (playing ? speed : BASE_SPEED * 0.4) * w;
      scroll += vx * dt;
      for (const it of items) { it.x -= vx * dt; it.t += dt; }

      if (playing && !dying) {
        for (const it of items) {
          if (it.x < -60) continue;
          const dx = Math.abs(it.x - px); const sameLane = it.lane === laneRef.current && Math.abs(playerY - laneY(it.lane)) < laneH * 0.45;
          if (it.kind === 'coin' && sameLane && dx < pr * 1.1) {
            it.x = -999; coins++; combo++; maxCombo = Math.max(maxCombo, combo);
            parts.burst(px + pr * 0.6, playerY, '#b9f17b', 12, 200, { gravity: 120 });
            pops.add(px + 10, playerY - pr - 10, '+10', '#d8ffa8', 18);
            sfx.coin(combo); haptic(5);
            if (combo % 10 === 0) { pops.add(w / 2, h * 0.2, `${combo}x COMBO!`, '#ffd34d', 28); setMode(combo % 20 === 0 ? 'ULTRA RUSH' : 'FEVER COINS'); sfx.combo(combo / 10); }
          } else if (it.kind === 'block' && sameLane && dx < pr * 1.15) {
            dying = 0.0001; combo = 0; flash = 1;
            parts.burst(px, playerY, '#ff8f6b', 30, 320); parts.burst(px, playerY, '#ffd34d', 14, 200);
            shake.add(14, 0.45); sfx.hit(); haptic([40, 30, 60]);
          }
        }
        items = items.filter((it) => it.x > -60);
      }
      if (dying) { dying += rawDt; if (dying > 0.75) finish(); }
      if (!dying && playing) parts.trail(px - pr, playerY + (Math.random() - 0.5) * pr, '#8bd1d4', 2.5);
      parts.update(dt); pops.update(rawDt); shake.update(rawDt); flash = Math.max(0, flash - rawDt * 3);

      hudT += rawDt;
      if (playing && hudT > 0.1) { hudT = 0; setHud({ coins, combo, dist: Math.floor(dist) }); }

      // ---------- draw ----------
      ctx.save();
      shake.apply(ctx);
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#0b1230'); sky.addColorStop(0.55, '#1d1747'); sky.addColorStop(1, '#0a0f1c');
      ctx.fillStyle = sky; ctx.fillRect(-20, -20, w + 40, h + 40);
      // glow sun
      const sun = ctx.createRadialGradient(w * 0.78, h * 0.26, 4, w * 0.78, h * 0.26, h * 0.35);
      sun.addColorStop(0, 'rgba(255,143,107,.55)'); sun.addColorStop(1, 'rgba(255,143,107,0)');
      ctx.fillStyle = sun; ctx.fillRect(0, 0, w, h);
      for (const s of stars) {
        const sx = ((s.x * w - scroll * 0.02) % w + w) % w;
        ctx.globalAlpha = reduced ? 0.6 : 0.35 + 0.35 * Math.sin(time * 2 + s.p);
        ctx.fillStyle = '#fff'; ctx.fillRect(sx, s.y * h, s.s, s.s);
      }
      ctx.globalAlpha = 1;
      // far skyline (parallax)
      ctx.fillStyle = '#231d55';
      for (const tw of towers) {
        const tx = (((tw.x * w * 1.2 - scroll * 0.08) % (w * 1.2)) + w * 1.2) % (w * 1.2) - w * 0.1;
        ctx.fillRect(tx, trackTop - tw.h * h, tw.w * w, tw.h * h + 2);
      }
      // track
      const track = ctx.createLinearGradient(0, trackTop, 0, trackTop + laneH * 3);
      track.addColorStop(0, 'rgba(139,209,212,.10)'); track.addColorStop(1, 'rgba(185,241,123,.05)');
      ctx.fillStyle = track; ctx.fillRect(0, trackTop, w, laneH * 3);
      ctx.strokeStyle = 'rgba(139,209,212,.35)'; ctx.lineWidth = 1.5;
      for (let i = 0; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(0, trackTop + laneH * i); ctx.lineTo(w, trackTop + laneH * i); ctx.stroke(); }
      // moving dashes
      ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 2;
      const gap = 46; const off = scroll % gap;
      for (let l = 0; l < 3; l++) for (let x = -off; x < w; x += gap) { ctx.beginPath(); ctx.moveTo(x, laneY(l) + laneH * 0.38); ctx.lineTo(x + 16, laneY(l) + laneH * 0.38); ctx.stroke(); }
      // items
      for (const it of items) {
        const y = laneY(it.lane);
        if (it.kind === 'coin') drawGem(ctx, it.x, y + Math.sin(it.t * 5) * 3, pr * 0.5, '#b9f17b', '#3e9b54', it.t);
        else {
          const s = pr * 1.7;
          ctx.save(); ctx.shadowColor = '#ff6b8b'; ctx.shadowBlur = 20;
          const g = ctx.createLinearGradient(it.x - s / 2, y - s / 2, it.x + s / 2, y + s / 2);
          g.addColorStop(0, '#ff9b7a'); g.addColorStop(1, '#c2335c');
          ctx.fillStyle = g; roundRect(ctx, it.x - s / 2, y - s / 2, s, s, 9); ctx.fill();
          ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,.22)'; roundRect(ctx, it.x - s / 2 + 4, y - s / 2 + 4, s - 8, s * 0.32, 6); ctx.fill();
          ctx.strokeStyle = 'rgba(40,0,20,.5)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(it.x - s * 0.2, y - s * 0.05); ctx.lineTo(it.x + s * 0.2, y + s * 0.25); ctx.moveTo(it.x + s * 0.2, y - s * 0.05); ctx.lineTo(it.x - s * 0.2, y + s * 0.25); ctx.stroke();
          ctx.restore();
        }
      }
      parts.draw(ctx);
      // player shadow + avatar
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(px, playerY + pr + 4, pr * 0.8, pr * 0.22, 0, 0, Math.PI * 2); ctx.fill();
      const bob = playing && !dying && !reduced ? Math.sin(time * 14) * 2 : 0;
      drawAvatar(ctx, img, px, playerY + bob, pr, dying ? '#ff8f6b' : '#b9f17b', dying ? dying * 6 : 0);
      pops.draw(ctx);
      // speed bar
      const pct = Math.min(1, speed / (BASE_SPEED * character.speed * 2.2));
      ctx.fillStyle = 'rgba(255,255,255,.08)'; roundRect(ctx, 14, h - 14, w - 28, 5, 3); ctx.fill();
      const sb = ctx.createLinearGradient(14, 0, w - 14, 0); sb.addColorStop(0, '#8bd1d4'); sb.addColorStop(1, '#b9f17b');
      ctx.fillStyle = sb; roundRect(ctx, 14, h - 14, (w - 28) * pct, 5, 3); ctx.fill();
      ctx.restore();
      if (flash > 0) { ctx.fillStyle = `rgba(255,110,90,${flash * 0.35})`; ctx.fillRect(0, 0, w, h); }
      return !ended;
    });
    return () => { stop(); window.removeEventListener('resize', onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, runId, character.id]);

  const touchStart = useRef<{ y: number; t: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => { touchStart.current = { y: e.clientY, t: performance.now() }; };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = touchStart.current; touchStart.current = null; if (!s) return;
    const dy = e.clientY - s.y;
    if (Math.abs(dy) > 24) { move(dy < 0 ? -1 : 1); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientY - rect.top) / rect.height;
    move(rel < 0.5 ? -1 : 1);
  };

  const start = () => { setResult(null); setHud({ coins: 0, combo: 0, dist: 0 }); setMode('SPARK RUN'); setRunId((r) => r + 1); setPhase('playing'); };

  return (
    <GameShell
      theme="spark" eyebrow={`ARCADE RUN / ${character.name.toUpperCase()}`} title="Spark Run" mode={phase === 'playing' ? mode : undefined}
      icon={<Gamepad2 size={20} />} phase={phase} best={best} result={result}
      howTo="Swipe or tap above/below your runner to switch lanes. Grab gems, dodge the red blocks, build combos."
      onStart={start} onRestart={start} onClose={onClose} againLabel="Run again"
      hud={<>
        <span className="hud-chip"><Sparkles size={14} /> {hud.coins}</span>
        <span className="hud-chip"><Zap size={14} /> {hud.combo}x</span>
        <span className="hud-chip"><Trophy size={14} /> {hud.dist}m</span>
      </>}
      controls={<>
        <button className="arcade-pad" onPointerDown={(e) => { e.preventDefault(); move(-1); }} aria-label="Lane up"><ChevronUp size={22} /></button>
        <button className="arcade-pad" onPointerDown={(e) => { e.preventDefault(); move(1); }} aria-label="Lane down"><ChevronDown size={22} /></button>
      </>}
      footnote="Arrow keys / W-S or swipe · gems earn play sparks"
    >
      <canvas ref={canvasRef} className="arcade-canvas" onPointerDown={onPointerDown} onPointerUp={onPointerUp} />
    </GameShell>
  );
}
