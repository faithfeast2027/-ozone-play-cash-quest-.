import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Coins, Flame, ArrowUp, Trophy } from 'lucide-react';
import { creditSparks, fetchWallet, getOrCreatePlayerId } from '@/lib/supabase';
import type { Character } from '@/components/SparkRunGame';
import GameShell, { type Phase, type RunResult } from '@/components/GameShell';
import { Particles, Popups, Shake, fitCanvas, startLoop, loadImage, drawAvatar, drawCoin, roundRect, prefersReducedMotion } from '@/lib/juice';
import { sfx, haptic } from '@/lib/sfx';
import { reportGameResult } from '@/lib/progress';

type Props = {
  character: Character;
  onClose: () => void;
  onWalletUpdate?: () => void;
};

type Obstacle = { x: number; kind: 'spike' | 'block'; w: number; h: number };
type Platform = { x: number; y: number; w: number };
type Coin = { x: number; y: number; t: number };

const BASE_SPEED = 0.5; // screen widths / second
const BEST_KEY = 'temple_mario_best';

export default function TempleMarioRun({ character, onClose, onWalletUpdate }: Props) {
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, setHud] = useState({ score: 0, coins: 0, combo: 0, dist: 0 });
  const [mode, setMode] = useState('TEMPLE RUN');
  const [result, setResult] = useState<RunResult | null>(null);
  const [runId, setRunId] = useState(0);
  const [best, setBest] = useState(() => parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const jumpReq = useRef(0);
  const phaseRef = useRef<Phase>('ready');
  const playerIdRef = useRef(getOrCreatePlayerId());
  phaseRef.current = phase;

  const jump = useCallback(() => { if (phaseRef.current === 'playing') jumpReq.current = performance.now(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w') { if (phaseRef.current === 'playing') { e.preventDefault(); jump(); } }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [jump]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const img = loadImage(character.image);
    const reduced = prefersReducedMotion();
    const parts = new Particles(); const pops = new Popups(); const shake = new Shake();
    const playing = phase === 'playing';
    let stage = fitCanvas(canvas);
    const onResize = () => { stage = fitCanvas(canvas); };
    window.addEventListener('resize', onResize);

    let obstacles: Obstacle[] = []; let platforms: Platform[] = []; let coinList: Coin[] = [];
    let speed = BASE_SPEED * character.speed;
    let score = 0; let coins = 0; let combo = 0; let dist = 0;
    let y = 0; let vy = 0; let grounded = true; let jumps = 0; let coyote = 0; let squash = 0;
    let spawnT = 0.8; let eventT = 0; let hudT = 0; let time = 0; let scroll = 0; let dying = 0; let ended = false;
    jumpReq.current = 0;

    const finish = () => {
      if (ended) return; ended = true;
      const finalScore = Math.floor(score);
      const prevBest = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
      const isBest = finalScore > prevBest;
      if (isBest) { localStorage.setItem(BEST_KEY, String(finalScore)); setBest(finalScore); }
      const sparks = coins + Math.floor(finalScore / 25);
      if (coins > 0) {
        creditSparks(playerIdRef.current, sparks, 'temple_mario_run', character.id)
          .then(() => { fetchWallet(playerIdRef.current).then(() => onWalletUpdate?.()); })
          .catch(() => {});
      }
      const rep = reportGameResult('temple', finalScore);
      sfx.over();
      setResult({ score: finalScore, best: Math.max(prevBest, finalScore), isBest, xp: rep.xpGained, sparks: coins > 0 ? Math.min(sparks, 180) : 0, level: rep.level, leveledUp: rep.leveledUp, headline: 'Run complete', sub: `${coins} coins · ${Math.floor(dist)}m` });
      setPhase('over');
    };

    const stop = startLoop((rawDt) => {
      const { ctx, w, h } = stage;
      const dt = dying ? rawDt * 0.3 : rawDt;
      time += rawDt;
      const groundY = h * 0.8;
      const pr = Math.min(h * 0.065, 28);
      const px = w * 0.18;
      const apex = h * 0.34; const T = 0.72;
      const G = (8 * apex) / (T * T); const V0 = (4 * apex) / T;

      if (playing && !dying) {
        dist += (speed / BASE_SPEED) * 6 * dt;
        score += (speed / BASE_SPEED) * 15 * dt;
        // jump with buffer + coyote time + double jump
        coyote = grounded ? 0.1 : Math.max(0, coyote - dt);
        if (jumpReq.current && performance.now() - jumpReq.current < 130) {
          if (grounded || coyote > 0) { vy = -V0; grounded = false; jumps = 1; coyote = 0; jumpReq.current = 0; sfx.jump(); haptic(8); squash = -0.25; parts.burst(px, groundY, '#e9cf9a', 8, 120, { gravity: 300, size: 2 }); }
          else if (jumps < 2) { vy = -V0 * 0.82; jumps = 2; jumpReq.current = 0; sfx.jump(); haptic(6); parts.burst(px, y, '#ffd34d', 10, 160, { gravity: 0, size: 2 }); }
        }
        vy += G * dt; y += vy * dt;
        let landed = false;
        if (y >= 0) { if (!grounded && vy > 0) landed = true; y = 0; vy = 0; grounded = true; jumps = 0; }
        else grounded = false;
        for (const p of platforms) {
          const top = p.y - groundY; // negative offset
          const prevY = y - vy * dt;
          if (px + pr * 0.6 > p.x && px - pr * 0.6 < p.x + p.w && vy >= 0 && prevY <= top + 1 && y >= top - 1) {
            if (!grounded) landed = true; y = top; vy = 0; grounded = true; jumps = 0;
          }
        }
        if (landed) { squash = 0.25; parts.burst(px, groundY + y, '#e9cf9a', 6, 90, { gravity: 200, size: 2 }); }

        spawnT -= dt; eventT += dt;
        if (spawnT <= 0) {
          spawnT = Math.max(0.75, 1.25 - dist / 3000) * (0.85 + Math.random() * 0.4);
          const roll = Math.random(); const sx = w + 40;
          if (roll < 0.33) obstacles.push({ x: sx, kind: 'spike', w: pr * 1.6, h: pr * 1.1 });
          else if (roll < 0.53) obstacles.push({ x: sx, kind: 'block', w: pr * 1.7, h: pr * 1.7 });
          else if (roll < 0.76) {
            const py = groundY - h * (0.2 + Math.random() * 0.1); const pw = w * (0.16 + Math.random() * 0.1);
            platforms.push({ x: sx, y: py, w: pw });
            for (let c = 0; c < 3; c++) coinList.push({ x: sx + pw * (0.2 + c * 0.3), y: py - pr * 1.4, t: c });
          } else {
            for (let c = 0; c < 5; c++) coinList.push({ x: sx + c * pr * 1.6, y: groundY - pr - Math.sin((c / 4) * Math.PI) * h * 0.2, t: c });
          }
        }
        if (eventT > 25) {
          eventT = 0; const ev = ['TEMPLE SURGE', 'COIN FRENZY', 'SPEED RUSH'];
          setMode(ev[Math.floor(Math.random() * ev.length)]); speed = Math.min(speed * 1.12, BASE_SPEED * character.speed * 2.4); sfx.combo(4);
        }
      }
      squash *= Math.pow(0.0001, rawDt);
      const vx = (playing ? speed : BASE_SPEED * 0.35) * w;
      scroll += vx * dt;
      for (const o of obstacles) o.x -= vx * dt;
      for (const p of platforms) p.x -= vx * dt;
      for (const c of coinList) { c.x -= vx * dt; c.t += dt; }
      obstacles = obstacles.filter((o) => o.x > -80); platforms = platforms.filter((p) => p.x + p.w > -40); coinList = coinList.filter((c) => c.x > -40);

      const py = groundY + y - pr; // player center
      if (playing && !dying) {
        coinList = coinList.filter((c) => {
          if (Math.hypot(c.x - px, c.y - py) < pr * 1.15) {
            coins++; combo++; score += 10;
            parts.burst(c.x, c.y, '#ffd34d', 12, 180, { gravity: 200 }); pops.add(c.x, c.y - 14, '+10', '#ffe17d', 17);
            sfx.coin(combo); haptic(4);
            if (combo % 10 === 0) { pops.add(w / 2, h * 0.22, `${combo}x COMBO!`, '#ffd34d', 28); setMode(combo % 20 === 0 ? 'COIN FRENZY' : 'TEMPLE SURGE'); sfx.combo(combo / 10); }
            return false;
          }
          return true;
        });
        for (const o of obstacles) {
          const inX = Math.abs(o.x + o.w / 2 - px) < o.w / 2 + pr * 0.55;
          const feet = groundY + y;
          if (inX && feet > groundY - o.h + pr * 0.25) {
            dying = 0.0001; combo = 0;
            parts.burst(px, py, '#ff8f6b', 30, 300); shake.add(13, 0.45); sfx.hit(); haptic([40, 30, 70]);
            break;
          }
        }
      }
      if (dying) { dying += rawDt; if (dying > 0.75) finish(); }
      parts.update(dt); pops.update(rawDt); shake.update(rawDt);
      hudT += rawDt;
      if (playing && hudT > 0.1) { hudT = 0; setHud({ score: Math.floor(score), coins, combo, dist: Math.floor(dist) }); }

      // ---------- draw ----------
      ctx.save(); shake.apply(ctx);
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#2b1640'); sky.addColorStop(0.45, '#a8425a'); sky.addColorStop(0.8, '#f2a65a'); sky.addColorStop(1, '#f7c978');
      ctx.fillStyle = sky; ctx.fillRect(-20, -20, w + 40, h + 40);
      const sun = ctx.createRadialGradient(w * 0.7, h * 0.52, 2, w * 0.7, h * 0.52, h * 0.3);
      sun.addColorStop(0, 'rgba(255,240,190,1)'); sun.addColorStop(0.25, 'rgba(255,214,140,.8)'); sun.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = sun; ctx.fillRect(0, 0, w, h);
      // far mountains
      const layer = (par: number, base: number, amp: number, color: string, freq: number) => {
        ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, h);
        for (let x = 0; x <= w + 10; x += 10) { const wx = x + scroll * par; ctx.lineTo(x, base - Math.abs(Math.sin(wx * freq)) * amp - Math.sin(wx * freq * 0.37) * amp * 0.4); }
        ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
      };
      layer(0.05, groundY - h * 0.18, h * 0.16, 'rgba(90,40,80,.55)', 0.006);
      // temple pillars (mid parallax)
      const pillarGap = w * 0.42; const poff = (scroll * 0.22) % pillarGap;
      for (let x = -poff; x < w + pillarGap; x += pillarGap) {
        ctx.fillStyle = 'rgba(70,30,45,.55)';
        ctx.fillRect(x, groundY - h * 0.42, w * 0.05, h * 0.42); ctx.fillRect(x + w * 0.16, groundY - h * 0.42, w * 0.05, h * 0.42);
        ctx.fillRect(x - w * 0.015, groundY - h * 0.46, w * 0.24, h * 0.05);
        ctx.beginPath(); ctx.moveTo(x - w * 0.02, groundY - h * 0.46); ctx.lineTo(x + w * 0.105, groundY - h * 0.56); ctx.lineTo(x + w * 0.23, groundY - h * 0.46); ctx.fill();
      }
      layer(0.4, groundY - h * 0.02, h * 0.06, 'rgba(40,70,40,.75)', 0.02);
      // ground
      const gg = ctx.createLinearGradient(0, groundY, 0, h);
      gg.addColorStop(0, '#c68a4a'); gg.addColorStop(0.15, '#8f5a2c'); gg.addColorStop(1, '#4a2b16');
      ctx.fillStyle = gg; ctx.fillRect(0, groundY, w, h - groundY);
      ctx.fillStyle = '#7dbb4a'; ctx.fillRect(0, groundY - 3, w, 5);
      const tile = 38; const toff = scroll % tile;
      ctx.strokeStyle = 'rgba(60,30,10,.35)'; ctx.lineWidth = 2;
      for (let x = -toff; x < w; x += tile) { ctx.beginPath(); ctx.moveTo(x, groundY + 4); ctx.lineTo(x - 8, h); ctx.stroke(); }
      // platforms
      for (const p of platforms) {
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 6;
        const pg = ctx.createLinearGradient(0, p.y, 0, p.y + 16); pg.addColorStop(0, '#e2b06a'); pg.addColorStop(1, '#93602f');
        ctx.fillStyle = pg; roundRect(ctx, p.x, p.y, p.w, 16, 7); ctx.fill(); ctx.restore();
        ctx.fillStyle = '#7dbb4a'; roundRect(ctx, p.x, p.y - 2, p.w, 5, 3); ctx.fill();
      }
      // obstacles
      for (const o of obstacles) {
        ctx.save();
        if (o.kind === 'spike') {
          ctx.shadowColor = '#ff6b5b'; ctx.shadowBlur = 14;
          const n = 3; const sw = o.w / n;
          for (let i = 0; i < n; i++) {
            const sg = ctx.createLinearGradient(0, groundY - o.h, 0, groundY); sg.addColorStop(0, '#fff1e0'); sg.addColorStop(0.3, '#ff8f6b'); sg.addColorStop(1, '#8a2a2a');
            ctx.fillStyle = sg; ctx.beginPath(); ctx.moveTo(o.x + i * sw, groundY); ctx.lineTo(o.x + i * sw + sw / 2, groundY - o.h); ctx.lineTo(o.x + (i + 1) * sw, groundY); ctx.closePath(); ctx.fill();
          }
        } else {
          ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
          const bg = ctx.createLinearGradient(o.x, groundY - o.h, o.x + o.w, groundY); bg.addColorStop(0, '#b98a5a'); bg.addColorStop(1, '#6a4422');
          ctx.fillStyle = bg; roundRect(ctx, o.x, groundY - o.h, o.w, o.h, 6); ctx.fill();
          ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; ctx.strokeStyle = 'rgba(40,20,5,.55)'; ctx.lineWidth = 3;
          ctx.strokeRect(o.x + 5, groundY - o.h + 5, o.w - 10, o.h - 10);
          ctx.beginPath(); ctx.moveTo(o.x + 5, groundY - o.h + 5); ctx.lineTo(o.x + o.w - 5, groundY - 5); ctx.stroke();
        }
        ctx.restore();
      }
      for (const c of coinList) drawCoin(ctx, c.x, c.y + Math.sin(c.t * 4) * 2, pr * 0.42, c.t);
      parts.draw(ctx);
      // player
      const shadowScale = Math.max(0.35, 1 + y / (h * 0.5));
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(px, groundY + 2, pr * 0.85 * shadowScale, pr * 0.2 * shadowScale, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.translate(px, py);
      const sq = reduced ? 0 : squash; ctx.scale(1 + sq * 0.6, 1 - sq * 0.6);
      const runBob = playing && grounded && !dying && !reduced ? Math.abs(Math.sin(time * 16)) * -3 : 0;
      drawAvatar(ctx, img, 0, runBob, pr, dying ? '#ff8f6b' : '#ffd34d', dying ? dying * 8 : jumps === 2 ? time * 14 : 0);
      ctx.restore();
      pops.draw(ctx);
      const pct = Math.min(1, speed / (BASE_SPEED * character.speed * 2.4));
      ctx.fillStyle = 'rgba(0,0,0,.25)'; roundRect(ctx, 14, h - 12, w - 28, 5, 3); ctx.fill();
      const sb = ctx.createLinearGradient(14, 0, w - 14, 0); sb.addColorStop(0, '#ffd34d'); sb.addColorStop(1, '#ff8f6b');
      ctx.fillStyle = sb; roundRect(ctx, 14, h - 12, (w - 28) * pct, 5, 3); ctx.fill();
      ctx.restore();
      return !ended;
    });
    return () => { stop(); window.removeEventListener('resize', onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, runId, character.id]);

  const start = () => { setResult(null); setHud({ score: 0, coins: 0, combo: 0, dist: 0 }); setMode('TEMPLE RUN'); setRunId((r) => r + 1); setPhase('playing'); };

  return (
    <GameShell
      theme="temple" eyebrow={`TEMPLE RUN / ${character.name.toUpperCase()}`} title="Temple Mario Run" mode={phase === 'playing' ? mode : undefined}
      icon={<Coins size={20} />} phase={phase} best={best} result={result}
      howTo="Tap anywhere to jump, tap again in the air to double-jump. Land on ledges, grab coins, dodge spikes and crates."
      onStart={start} onRestart={start} onClose={onClose} againLabel="Run again"
      hud={<>
        <span className="hud-chip"><Sparkles size={14} /> {hud.score}</span>
        <span className="hud-chip"><Coins size={14} /> {hud.coins}</span>
        <span className="hud-chip"><Flame size={14} /> {hud.combo}x</span>
        <span className="hud-chip"><Trophy size={14} /> {hud.dist}m</span>
      </>}
      controls={<button className="arcade-pad primary" onPointerDown={(e) => { e.preventDefault(); jump(); }}><ArrowUp size={20} /> Jump</button>}
      footnote="Space / tap to jump · double-jump in the air · coins earn play sparks"
    >
      <canvas ref={canvasRef} className="arcade-canvas" onPointerDown={(e) => { e.preventDefault(); jump(); }} />
    </GameShell>
  );
}
