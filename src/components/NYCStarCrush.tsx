import { useEffect, useRef, useState } from 'react';
import { Star, Sparkles, Heart, Flame, Waves, ChevronLeft, ChevronRight, Crosshair } from 'lucide-react';
import { creditSparks, fetchWallet, getOrCreatePlayerId } from '@/lib/supabase';
import type { Character } from '@/components/SparkRunGame';
import GameShell, { type Phase, type RunResult } from '@/components/GameShell';
import { Particles, Popups, Shake, fitCanvas, startLoop, loadImage, drawAvatar, roundRect, clamp, prefersReducedMotion } from '@/lib/juice';
import { sfx, haptic } from '@/lib/sfx';
import { reportGameResult } from '@/lib/progress';

type Props = {
  character: Character;
  onClose: () => void;
  onWalletUpdate?: () => void;
};

type Kind = 'star' | 'block' | 'gold';
type Target = { id: number; x: number; y: number; vx: number; vy: number; kind: Kind; r: number; hp: number; rot: number; hitT: number };
type Shot = { x: number; y: number };

const BEST_KEY = 'nyc_star_best';
const FIRE_COOLDOWN = 0.18;

function starPath(ctx: CanvasRenderingContext2D, r: number, inner = 0.48) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5; const rr = i % 2 ? r * inner : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  ctx.closePath();
}

export default function NYCStarCrush({ character, onClose, onWalletUpdate }: Props) {
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, setHud] = useState({ score: 0, combo: 0, lives: 3, wave: 1 });
  const [mode, setMode] = useState('STAR CRUSH');
  const [result, setResult] = useState<RunResult | null>(null);
  const [runId, setRunId] = useState(0);
  const [best, setBest] = useState(() => parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const aimRef = useRef(0.5); // 0..1
  const firing = useRef(false);
  const fireOnce = useRef(false);
  const keys = useRef({ left: false, right: false });
  const phaseRef = useRef<Phase>('ready');
  const playerIdRef = useRef(getOrCreatePlayerId());
  phaseRef.current = phase;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (phaseRef.current !== 'playing') return;
      if (e.key === 'ArrowLeft' || e.key === 'a') keys.current.left = true;
      if (e.key === 'ArrowRight' || e.key === 'd') keys.current.right = true;
      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w') { e.preventDefault(); firing.current = true; fireOnce.current = true; }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') keys.current.left = false;
      if (e.key === 'ArrowRight' || e.key === 'd') keys.current.right = false;
      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w') firing.current = false;
    };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const img = loadImage(character.image);
    const reduced = prefersReducedMotion();
    const parts = new Particles(); const pops = new Popups(); const shake = new Shake();
    const playing = phase === 'playing';
    let stage = fitCanvas(canvas);
    const onResize = () => { stage = fitCanvas(canvas); };
    window.addEventListener('resize', onResize);

    let targets: Target[] = []; let shots: Shot[] = [];
    let score = 0; let combo = 0; let lives = 3; let wave = 1; let starsHit = 0;
    let spawnT = 0.5; let spawnEvery = 0.9; let cool = 0; let hudT = 0; let time = 0; let id = 0; let ended = false; let dying = 0; let hurt = 0;
    let shooterX = stage.w * 0.5;
    aimRef.current = 0.5; firing.current = false; keys.current = { left: false, right: false };
    const sky = Array.from({ length: 80 }, () => ({ x: Math.random(), y: Math.random() * 0.7, s: Math.random() * 1.5 + 0.3, p: Math.random() * 6 }));
    const mkCity = (n: number, minH: number, maxH: number) => Array.from({ length: n }, (_, i) => ({ x: i / n, w: 1 / n * (0.7 + Math.random() * 0.5), h: minH + Math.random() * (maxH - minH), lit: Array.from({ length: 24 }, () => Math.random() < 0.35), spire: Math.random() < 0.18 }));
    const farCity = mkCity(16, 0.12, 0.3); const nearCity = mkCity(10, 0.08, 0.2);

    const finish = () => {
      if (ended) return; ended = true;
      const prevBest = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
      const isBest = score > prevBest;
      if (isBest) { localStorage.setItem(BEST_KEY, String(score)); setBest(score); }
      const sparks = Math.floor(score / 12) + starsHit * 2;
      if (score > 0) {
        creditSparks(playerIdRef.current, sparks, 'nyc_star_crush', character.id)
          .then(() => { fetchWallet(playerIdRef.current).then(() => onWalletUpdate?.()); })
          .catch(() => {});
      }
      const rep = reportGameResult('nyc', score);
      sfx.over();
      setResult({ score, best: Math.max(prevBest, score), isBest, xp: rep.xpGained, sparks: score > 0 ? Math.min(sparks, 200) : 0, level: rep.level, leveledUp: rep.leveledUp, headline: 'Star Crush complete', sub: `Wave ${wave} · ${starsHit} stars crushed` });
      setPhase('over');
    };

    const spawn = () => {
      const { w, h } = stage;
      const roll = Math.random();
      const kind: Kind = roll < 0.15 ? 'gold' : roll < 0.45 ? 'block' : 'star';
      const base = Math.min(w, h);
      const r = kind === 'block' ? base * 0.055 : kind === 'gold' ? base * 0.05 : base * 0.042;
      targets.push({ id: id++, x: r + Math.random() * (w - r * 2), y: -r, vx: (Math.random() - 0.5) * w * 0.06, vy: h * (0.1 + Math.random() * 0.06 + wave * 0.009), kind, r, hp: kind === 'block' ? 2 : 1, rot: Math.random() * 6, hitT: 0 });
    };

    const stop = startLoop((rawDt) => {
      const { ctx, w, h } = stage;
      const dt = dying ? rawDt * 0.3 : rawDt;
      time += rawDt;
      const skylineY = h * 0.86;
      const sr = Math.min(h * 0.05, 24);
      const sy = h - sr - 10;

      if (playing && !dying) {
        if (keys.current.left) aimRef.current = clamp(aimRef.current - dt * 0.9, 0.04, 0.96);
        if (keys.current.right) aimRef.current = clamp(aimRef.current + dt * 0.9, 0.04, 0.96);
        spawnT -= dt;
        if (spawnT <= 0) { spawnT = spawnEvery; spawn(); if (wave > 2 && Math.random() < 0.3) spawn(); }
        cool -= dt;
        if ((firing.current || fireOnce.current) && cool <= 0) { fireOnce.current = false; cool = FIRE_COOLDOWN; shots.push({ x: shooterX, y: sy - sr }); sfx.shoot(); }
      }
      shooterX += (aimRef.current * w - shooterX) * (1 - Math.pow(0.00002, rawDt));
      for (const s of shots) s.y -= h * 1.9 * dt;
      shots = shots.filter((s) => s.y > -20);
      for (const t of targets) { t.x = clamp(t.x + t.vx * dt, t.r, w - t.r); if (t.x <= t.r || t.x >= w - t.r) t.vx *= -1; t.y += t.vy * dt; t.rot += dt * 1.6; t.hitT = Math.max(0, t.hitT - dt); }

      if (playing && !dying) {
        const remaining: Shot[] = [];
        for (const s of shots) {
          let hit = false;
          for (const t of targets) {
            if (t.hp <= 0) continue;
            if (Math.hypot(t.x - s.x, t.y - s.y) < t.r + 6) {
              hit = true; t.hp--; t.hitT = 0.12;
              if (t.hp <= 0) {
                const pts = t.kind === 'gold' ? 50 : t.kind === 'block' ? 25 : 15;
                const bonus = Math.floor(combo / 5) * 5;
                score += pts + bonus; combo++;
                if (t.kind !== 'block') starsHit++;
                const color = t.kind === 'gold' ? '#ffd34d' : t.kind === 'block' ? '#a98bff' : '#fff6b0';
                parts.burst(t.x, t.y, color, t.kind === 'gold' ? 28 : 18, 260, { gravity: 160 });
                pops.add(t.x, t.y - t.r, `+${pts + bonus}`, color, t.kind === 'gold' ? 22 : 17);
                sfx.pop(t.kind !== 'star'); haptic(t.kind === 'gold' ? [8, 20, 8] : 5);
                if (t.kind === 'gold') shake.add(4, 0.12);
                if (combo > 0 && combo % 12 === 0) { setMode(combo % 24 === 0 ? 'MANHATTAN FEVER' : 'STAR STORM'); pops.add(w / 2, h * 0.3, `${combo}x COMBO!`, '#ffd34d', 28); sfx.combo(combo / 12); }
              } else { parts.burst(t.x, t.y, '#ffffff', 6, 140, { gravity: 0 }); sfx.tick(); }
              break;
            }
          }
          if (!hit) remaining.push(s);
        }
        shots = remaining;
        targets = targets.filter((t) => t.hp > 0);
        for (const t of [...targets]) {
          if (t.y > skylineY) {
            lives--; combo = 0; hurt = 1;
            parts.burst(t.x, skylineY, '#ff6b6b', 20, 220); shake.add(11, 0.35); sfx.hit(); haptic([30, 30, 50]);
            pops.add(t.x, skylineY - 20, '-1 ♥', '#ff8f8f', 20);
            targets = targets.filter((x) => x.id !== t.id);
            if (lives <= 0) { dying = 0.0001; break; }
          }
        }
        const nw = 1 + Math.floor(score / 300);
        if (nw !== wave) { wave = nw; spawnEvery = Math.max(0.42, 0.9 - wave * 0.07); pops.add(w / 2, h * 0.4, `WAVE ${wave}`, '#8bb8ff', 30); sfx.start(); }
      }
      if (dying) { dying += rawDt; if (dying > 0.8) finish(); }
      parts.update(dt); pops.update(rawDt); shake.update(rawDt); hurt = Math.max(0, hurt - rawDt * 2.5);
      hudT += rawDt;
      if (playing && hudT > 0.1) { hudT = 0; setHud({ score, combo, lives, wave }); }

      // ---------- draw ----------
      ctx.save(); shake.apply(ctx);
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#070b24'); bg.addColorStop(0.55, '#231a52'); bg.addColorStop(1, '#5a2a63');
      ctx.fillStyle = bg; ctx.fillRect(-20, -20, w + 40, h + 40);
      for (const s of sky) { ctx.globalAlpha = reduced ? 0.6 : 0.3 + 0.4 * Math.sin(time * 2 + s.p); ctx.fillStyle = '#fff'; ctx.fillRect(s.x * w, s.y * h, s.s, s.s); }
      ctx.globalAlpha = 1;
      const moon = ctx.createRadialGradient(w * 0.2, h * 0.16, 2, w * 0.2, h * 0.16, h * 0.14);
      moon.addColorStop(0, '#fffbe8'); moon.addColorStop(0.3, '#ffeeb8'); moon.addColorStop(0.32, 'rgba(255,238,184,.25)'); moon.addColorStop(1, 'rgba(255,238,184,0)');
      ctx.fillStyle = moon; ctx.fillRect(0, 0, w, h * 0.4);
      const drawCity = (city: typeof farCity, color: string, win: string, par: number, base: number) => {
        const off = Math.sin(time * 0.1) * 8 * par + (shooterX - w / 2) * -0.03 * par * 4;
        for (const b of city) {
          const bx = b.x * w + off; const bw = b.w * w; const bh = b.h * h; const top = base - bh;
          ctx.fillStyle = color; ctx.fillRect(bx, top, bw, bh + 4);
          if (b.spire) { ctx.beginPath(); ctx.moveTo(bx + bw * 0.3, top); ctx.lineTo(bx + bw * 0.5, top - bh * 0.35); ctx.lineTo(bx + bw * 0.7, top); ctx.fill(); }
          ctx.fillStyle = win;
          const cols = 3; const rows = Math.min(8, Math.floor(bh / 12));
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (b.lit[(r * cols + c) % 24]) ctx.fillRect(bx + bw * (0.18 + c * 0.25), top + 8 + r * 12, bw * 0.12, 5);
        }
      };
      drawCity(farCity, '#2a2560', 'rgba(255,220,140,.35)', 0.5, skylineY + 6);
      drawCity(nearCity, '#16123a', 'rgba(255,210,120,.75)', 1, h + 2);
      // danger line
      ctx.strokeStyle = `rgba(255,107,107,${0.25 + hurt * 0.6})`; ctx.setLineDash([6, 8]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, skylineY); ctx.lineTo(w, skylineY); ctx.stroke(); ctx.setLineDash([]);
      // targets
      for (const t of targets) {
        ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(t.kind === 'block' ? t.rot * 0.5 : t.rot);
        const flashHit = t.hitT > 0;
        if (t.kind === 'block') {
          ctx.shadowColor = '#a98bff'; ctx.shadowBlur = 18;
          const g = ctx.createLinearGradient(-t.r, -t.r, t.r, t.r); g.addColorStop(0, flashHit ? '#fff' : '#d4c6ff'); g.addColorStop(1, '#5b3fc7');
          ctx.fillStyle = g; roundRect(ctx, -t.r, -t.r, t.r * 2, t.r * 2, t.r * 0.35); ctx.fill();
          ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,.3)'; roundRect(ctx, -t.r + 4, -t.r + 4, t.r * 2 - 8, t.r * 0.6, t.r * 0.25); ctx.fill();
          if (t.hp === 1) { ctx.strokeStyle = 'rgba(30,10,60,.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-t.r * 0.5, -t.r * 0.6); ctx.lineTo(0, 0); ctx.lineTo(-t.r * 0.2, t.r * 0.6); ctx.moveTo(0, 0); ctx.lineTo(t.r * 0.6, t.r * 0.1); ctx.stroke(); }
        } else {
          const gold = t.kind === 'gold';
          ctx.shadowColor = gold ? '#ffcc33' : '#fff3a0'; ctx.shadowBlur = gold ? 26 : 16;
          const g = ctx.createRadialGradient(-t.r * 0.2, -t.r * 0.3, 1, 0, 0, t.r);
          g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, gold ? '#ffd34d' : '#fff4a8'); g.addColorStop(1, gold ? '#e08a00' : '#f2c94c');
          ctx.fillStyle = flashHit ? '#fff' : g; starPath(ctx, t.r); ctx.fill();
        }
        ctx.restore();
      }
      // shots
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const s of shots) {
        const g = ctx.createLinearGradient(s.x, s.y - 18, s.x, s.y + 6); g.addColorStop(0, 'rgba(139,184,255,0)'); g.addColorStop(1, '#bfe0ff');
        ctx.fillStyle = g; roundRect(ctx, s.x - 2.5, s.y - 18, 5, 24, 3); ctx.fill();
      }
      ctx.restore();
      parts.draw(ctx);
      // shooter
      ctx.strokeStyle = 'rgba(139,184,255,.18)'; ctx.lineWidth = 1; ctx.setLineDash([3, 6]);
      ctx.beginPath(); ctx.moveTo(shooterX, sy - sr - 6); ctx.lineTo(shooterX, h * 0.05); ctx.stroke(); ctx.setLineDash([]);
      drawAvatar(ctx, img, shooterX, sy, sr, dying ? '#ff6b6b' : '#8bb8ff');
      pops.draw(ctx);
      ctx.restore();
      if (hurt > 0) { const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75); v.addColorStop(0, 'rgba(255,60,60,0)'); v.addColorStop(1, `rgba(255,60,60,${hurt * 0.45})`); ctx.fillStyle = v; ctx.fillRect(0, 0, w, h); }
      return !ended;
    });
    return () => { stop(); window.removeEventListener('resize', onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, runId, character.id]);

  const aimFromPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    aimRef.current = clamp((e.clientX - rect.left) / rect.width, 0.04, 0.96);
  };

  const start = () => { setResult(null); setHud({ score: 0, combo: 0, lives: 3, wave: 1 }); setMode('STAR CRUSH'); setRunId((r) => r + 1); setPhase('playing'); };

  return (
    <GameShell
      theme="nyc" eyebrow={`NYC SKIES / ${character.name.toUpperCase()}`} title="NYC Star Crush" mode={phase === 'playing' ? mode : undefined}
      icon={<Star size={20} />} phase={phase} best={best} result={result}
      howTo="Drag to aim, hold to fire. Crush falling stars before they hit the skyline. Purple blocks take two hits."
      onStart={start} onRestart={start} onClose={onClose}
      hud={<>
        <span className="hud-chip"><Sparkles size={14} /> {hud.score}</span>
        <span className="hud-chip"><Flame size={14} /> {hud.combo}x</span>
        <span className="hud-chip warn"><Heart size={14} /> {hud.lives}</span>
        <span className="hud-chip"><Waves size={14} /> W{hud.wave}</span>
      </>}
      controls={<>
        <button className="arcade-pad" aria-label="Aim left" onPointerDown={(e) => { e.preventDefault(); keys.current.left = true; }} onPointerUp={() => { keys.current.left = false; }} onPointerLeave={() => { keys.current.left = false; }}><ChevronLeft size={22} /></button>
        <button className="arcade-pad primary" onPointerDown={(e) => { e.preventDefault(); firing.current = true; fireOnce.current = true; }} onPointerUp={() => { firing.current = false; }} onPointerLeave={() => { firing.current = false; }}><Crosshair size={18} /> Fire</button>
        <button className="arcade-pad" aria-label="Aim right" onPointerDown={(e) => { e.preventDefault(); keys.current.right = true; }} onPointerUp={() => { keys.current.right = false; }} onPointerLeave={() => { keys.current.right = false; }}><ChevronRight size={22} /></button>
      </>}
      footnote="Drag + hold on the sky, or arrows + space · gold stars are worth 50"
    >
      <canvas
        ref={canvasRef} className="arcade-canvas"
        onPointerDown={(e) => { if (phaseRef.current !== 'playing') return; e.currentTarget.setPointerCapture?.(e.pointerId); aimFromPointer(e); firing.current = true; fireOnce.current = true; }}
        onPointerMove={(e) => { if (phaseRef.current === 'playing' && (e.buttons || e.pointerType === 'mouse')) aimFromPointer(e); }}
        onPointerUp={() => { firing.current = false; }}
        onPointerCancel={() => { firing.current = false; }}
      />
    </GameShell>
  );
}
