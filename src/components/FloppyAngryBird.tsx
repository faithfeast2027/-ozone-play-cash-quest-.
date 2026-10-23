import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Bird, Target, Flame } from 'lucide-react';
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

type Pipe = { x: number; gapY: number; scored: boolean };
type Pig = { x: number; y: number; t: number };

const BASE_SPEED = 0.34; // widths / second
const BEST_KEY = 'floppy_angry_best';

export default function FloppyAngryBird({ character, onClose, onWalletUpdate }: Props) {
  const [phase, setPhase] = useState<Phase>('ready');
  const [hud, setHud] = useState({ score: 0, combo: 0, pigs: 0 });
  const [mode, setMode] = useState('FLOPPY LAUNCH');
  const [result, setResult] = useState<RunResult | null>(null);
  const [runId, setRunId] = useState(0);
  const [best, setBest] = useState(() => parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const flapReq = useRef(false);
  const phaseRef = useRef<Phase>('ready');
  const playerIdRef = useRef(getOrCreatePlayerId());
  phaseRef.current = phase;

  const flap = useCallback(() => { if (phaseRef.current === 'playing') flapReq.current = true; }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w') && phaseRef.current === 'playing') { e.preventDefault(); flap(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flap]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const img = loadImage(character.image);
    const reduced = prefersReducedMotion();
    const parts = new Particles(); const pops = new Popups(); const shake = new Shake();
    const playing = phase === 'playing';
    let stage = fitCanvas(canvas);
    const onResize = () => { stage = fitCanvas(canvas); };
    window.addEventListener('resize', onResize);

    let pipes: Pipe[] = []; let pigs: Pig[] = [];
    let speed = BASE_SPEED; let score = 0; let combo = 0; let pigsHit = 0; let passed = 0;
    let by = stage.h * 0.45; let vy = 0; let rot = 0;
    let spawnT = 0.6; let hudT = 0; let time = 0; let scroll = 0; let dying = 0; let ended = false; let flash = 0;
    flapReq.current = playing;
    const clouds = Array.from({ length: 7 }, () => ({ x: Math.random(), y: 0.08 + Math.random() * 0.35, s: 0.6 + Math.random() * 0.8, par: 0.05 + Math.random() * 0.12 }));

    const finish = () => {
      if (ended) return; ended = true;
      const prevBest = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
      const isBest = score > prevBest;
      if (isBest) { localStorage.setItem(BEST_KEY, String(score)); setBest(score); }
      const sparks = Math.floor(score / 8) + pigsHit * 3;
      if (score > 0) {
        creditSparks(playerIdRef.current, sparks, 'floppy_angry_bird', character.id)
          .then(() => { fetchWallet(playerIdRef.current).then(() => onWalletUpdate?.()); })
          .catch(() => {});
      }
      const rep = reportGameResult('floppy', score);
      sfx.over();
      setResult({ score, best: Math.max(prevBest, score), isBest, xp: rep.xpGained, sparks: score > 0 ? Math.min(sparks, 160) : 0, level: rep.level, leveledUp: rep.leveledUp, headline: 'Launch complete', sub: `${passed} pipes · ${pigsHit} pigs smashed` });
      setPhase('over');
    };

    const stop = startLoop((rawDt) => {
      const { ctx, w, h } = stage;
      const dt = dying ? rawDt * 0.4 : rawDt;
      time += rawDt;
      const groundY = h * 0.9;
      const br = Math.min(h * 0.045, 22);
      const bx = w * 0.26;
      const gap = Math.max(h * 0.3, br * 6.2);
      const pipeW = Math.max(52, w * 0.13);
      const G = h * 2.5; const FLAP = -h * 0.82;

      if (playing && !dying) {
        if (flapReq.current) { flapReq.current = false; vy = FLAP; sfx.flap(); haptic(6); parts.burst(bx - br, by + br * 0.4, '#ffffff', 6, 90, { gravity: 120, size: 2 }); }
        vy += G * dt; by += vy * dt;
        rot = clamp(vy / (h * 1.6), -0.45, 1.3);
        if (by < br) { by = br; vy = 0; }
        spawnT -= dt;
        if (spawnT <= 0) {
          spawnT = 1.55 / (speed / BASE_SPEED);
          const gapY = h * 0.12 + Math.random() * (groundY - gap - h * 0.2);
          pipes.push({ x: w + pipeW, gapY, scored: false });
          if (Math.random() < 0.5) pigs.push({ x: w + pipeW + pipeW / 2, y: gapY + gap / 2 + (Math.random() - 0.5) * gap * 0.3, t: 0 });
        }
      } else if (!playing) {
        by = h * 0.45 + Math.sin(time * 3) * 8; rot = Math.sin(time * 3) * 0.1;
      } else { vy += G * dt; by = Math.min(groundY - br, by + vy * dt); rot = Math.min(1.6, rot + dt * 6); }

      const vx = (playing ? speed : BASE_SPEED * 0.6) * w;
      scroll += vx * dt;
      if (playing) { for (const p of pipes) p.x -= vx * dt; for (const p of pigs) { p.x -= vx * dt; p.t += dt; } }
      pipes = pipes.filter((p) => p.x > -pipeW * 2); pigs = pigs.filter((p) => p.x > -40);

      if (playing && !dying) {
        const crash = () => { dying = 0.0001; combo = 0; flash = 1; parts.burst(bx, by, '#ff8f6b', 28, 280); parts.burst(bx, by, '#ffffff', 10, 180); shake.add(12, 0.4); sfx.hit(); haptic([40, 30, 70]); };
        if (by + br > groundY) crash();
        for (const p of pipes) {
          const inX = bx + br * 0.8 > p.x - pipeW / 2 && bx - br * 0.8 < p.x + pipeW / 2;
          if (inX && (by - br * 0.8 < p.gapY || by + br * 0.8 > p.gapY + gap)) { crash(); break; }
          if (!p.scored && p.x + pipeW / 2 < bx - br) {
            p.scored = true; score += 15; combo++; passed++;
            pops.add(bx + 20, by - br - 12, '+15', '#d8ffa8', 18); sfx.coin(combo); haptic(4);
            parts.burst(p.x + pipeW / 2, p.gapY + gap / 2, '#b9f17b', 10, 140, { gravity: 0 });
            if (combo % 5 === 0) { setMode(combo % 10 === 0 ? 'ANGRY FRENZY' : 'BIRD BLITZ'); speed = Math.min(speed * 1.08, BASE_SPEED * 2.2); pops.add(w / 2, h * 0.2, `${combo}x STREAK!`, '#ffd34d', 26); sfx.combo(combo / 5); }
          }
        }
        pigs = pigs.filter((pig) => {
          if (Math.hypot(pig.x - bx, pig.y - by) < br * 1.9) {
            pigsHit++; score += 25;
            parts.burst(pig.x, pig.y, '#8be05a', 22, 260); parts.burst(pig.x, pig.y, '#ffffff', 8, 160);
            pops.add(pig.x, pig.y - 20, '+25 SMASH', '#b9f17b', 20); shake.add(5, 0.15); sfx.pop(true); haptic([12, 20, 12]);
            return false;
          }
          return true;
        });
      }
      if (dying) { dying += rawDt; if (dying > 0.85) finish(); }
      parts.update(dt); pops.update(rawDt); shake.update(rawDt); flash = Math.max(0, flash - rawDt * 3);
      hudT += rawDt;
      if (playing && hudT > 0.1) { hudT = 0; setHud({ score, combo, pigs: pigsHit }); }

      // ---------- draw ----------
      ctx.save(); shake.apply(ctx);
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#3b8fd9'); sky.addColorStop(0.6, '#8fd0f0'); sky.addColorStop(1, '#ffe3b0');
      ctx.fillStyle = sky; ctx.fillRect(-20, -20, w + 40, h + 40);
      const sun = ctx.createRadialGradient(w * 0.82, h * 0.18, 4, w * 0.82, h * 0.18, h * 0.25);
      sun.addColorStop(0, 'rgba(255,255,230,1)'); sun.addColorStop(0.3, 'rgba(255,240,180,.6)'); sun.addColorStop(1, 'rgba(255,240,180,0)');
      ctx.fillStyle = sun; ctx.fillRect(0, 0, w, h);
      for (const c of clouds) {
        const cx = ((c.x * w * 1.4 - scroll * c.par) % (w * 1.4) + w * 1.4) % (w * 1.4) - w * 0.2; const cy = c.y * h; const s = c.s * Math.min(w, h) * 0.09;
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.beginPath(); ctx.arc(cx, cy, s, 0, Math.PI * 2); ctx.arc(cx + s * 0.9, cy + s * 0.2, s * 0.8, 0, Math.PI * 2); ctx.arc(cx - s * 0.9, cy + s * 0.25, s * 0.7, 0, Math.PI * 2); ctx.fill();
      }
      const hills = (par: number, base: number, amp: number, color: string, f: number) => {
        ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, h);
        for (let x = 0; x <= w + 10; x += 10) ctx.lineTo(x, base - (Math.sin((x + scroll * par) * f) * 0.5 + 0.5) * amp);
        ctx.lineTo(w, h); ctx.fill();
      };
      hills(0.15, groundY - h * 0.05, h * 0.14, '#7cc66a', 0.008);
      hills(0.35, groundY, h * 0.08, '#4fa64a', 0.014);
      // pipes
      for (const p of pipes) {
        const drawPipe = (y0: number, y1: number, capAtBottom: boolean) => {
          const g = ctx.createLinearGradient(p.x - pipeW / 2, 0, p.x + pipeW / 2, 0);
          g.addColorStop(0, '#2f8f3a'); g.addColorStop(0.35, '#8de06a'); g.addColorStop(0.6, '#4cb84a'); g.addColorStop(1, '#1f6a2a');
          ctx.fillStyle = g; ctx.fillRect(p.x - pipeW / 2 + 4, y0, pipeW - 8, y1 - y0);
          const capH = 22; const cy = capAtBottom ? y1 - capH : y0;
          ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
          ctx.fillStyle = g; roundRect(ctx, p.x - pipeW / 2 - 3, cy, pipeW + 6, capH, 7); ctx.fill(); ctx.restore();
          ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(p.x - pipeW / 2 + 9, y0, 5, y1 - y0);
        };
        drawPipe(-10, p.gapY, true);
        drawPipe(p.gapY + gap, groundY, false);
      }
      // pigs
      for (const pig of pigs) {
        const r = br * 1.05; const py = pig.y + Math.sin(pig.t * 4) * 4;
        ctx.save(); ctx.translate(pig.x, py);
        ctx.shadowColor = 'rgba(80,180,60,.6)'; ctx.shadowBlur = 14;
        const pg = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
        pg.addColorStop(0, '#d9ffb0'); pg.addColorStop(0.6, '#86d84e'); pg.addColorStop(1, '#4f9a2c');
        ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
        ctx.fillStyle = '#6fbf3e'; ctx.beginPath(); ctx.arc(-r * 0.6, -r * 0.8, r * 0.28, 0, Math.PI * 2); ctx.arc(r * 0.6, -r * 0.8, r * 0.28, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#a6e878'; ctx.beginPath(); ctx.ellipse(0, r * 0.15, r * 0.42, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2d5a18'; ctx.beginPath(); ctx.arc(-r * 0.15, r * 0.15, r * 0.08, 0, Math.PI * 2); ctx.arc(r * 0.15, r * 0.15, r * 0.08, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-r * 0.38, -r * 0.3, r * 0.16, 0, Math.PI * 2); ctx.arc(r * 0.38, -r * 0.3, r * 0.16, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(-r * 0.34, -r * 0.28, r * 0.07, 0, Math.PI * 2); ctx.arc(r * 0.34, -r * 0.28, r * 0.07, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      // ground
      const gg = ctx.createLinearGradient(0, groundY, 0, h); gg.addColorStop(0, '#e9c87a'); gg.addColorStop(1, '#b98a40');
      ctx.fillStyle = gg; ctx.fillRect(0, groundY, w, h - groundY);
      ctx.fillStyle = '#5cbf4a'; ctx.fillRect(0, groundY - 4, w, 6);
      const stripe = 26; const soff = scroll % stripe; ctx.fillStyle = 'rgba(120,80,20,.18)';
      for (let x = -soff; x < w; x += stripe) { ctx.beginPath(); ctx.moveTo(x, groundY + 2); ctx.lineTo(x + 12, groundY + 2); ctx.lineTo(x + 2, h); ctx.lineTo(x - 10, h); ctx.fill(); }
      parts.draw(ctx);
      // bird (character with wings)
      ctx.save(); ctx.translate(bx, by); ctx.rotate(reduced ? rot * 0.5 : rot);
      const wing = Math.sin(time * (playing ? 26 : 10)) * 0.6;
      ctx.fillStyle = '#ff8f6b';
      ctx.save(); ctx.rotate(-0.4 + wing); ctx.beginPath(); ctx.ellipse(-br * 0.9, -br * 0.1, br * 0.75, br * 0.32, -0.3, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      drawAvatar(ctx, img, 0, 0, br, dying ? '#ff5a4a' : '#ff8f6b');
      ctx.fillStyle = '#ffc63a'; ctx.beginPath(); ctx.moveTo(br * 0.85, -br * 0.15); ctx.lineTo(br * 1.45, br * 0.05); ctx.lineTo(br * 0.85, br * 0.3); ctx.closePath(); ctx.fill();
      ctx.restore();
      pops.draw(ctx);
      // big score
      if (playing) {
        ctx.save(); ctx.textAlign = 'center'; ctx.font = `900 ${Math.round(h * 0.11)}px ui-rounded, Nunito, system-ui`;
        ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.strokeText(String(score), w / 2, h * 0.16);
        ctx.fillStyle = '#fff'; ctx.fillText(String(score), w / 2, h * 0.16); ctx.restore();
      }
      ctx.restore();
      if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash * 0.6})`; ctx.fillRect(0, 0, w, h); }
      return !ended;
    });
    return () => { stop(); window.removeEventListener('resize', onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, runId, character.id]);

  const start = () => { setResult(null); setHud({ score: 0, combo: 0, pigs: 0 }); setMode('FLOPPY LAUNCH'); setRunId((r) => r + 1); setPhase('playing'); };

  return (
    <GameShell
      theme="floppy" eyebrow={`LAUNCH ARCADE / ${character.name.toUpperCase()}`} title="Floppy Angry Bird" mode={phase === 'playing' ? mode : undefined}
      icon={<Bird size={20} />} phase={phase} best={best} result={result}
      howTo="Tap to flap. Thread the pipe gaps and smash green pigs for bonus points."
      onStart={start} onRestart={start} onClose={onClose} startLabel="Launch" againLabel="Launch again"
      hud={<>
        <span className="hud-chip"><Target size={14} /> {hud.score}</span>
        <span className="hud-chip"><Flame size={14} /> {hud.combo}x</span>
        <span className="hud-chip"><Bird size={14} /> {hud.pigs}</span>
      </>}
      controls={<button className="arcade-pad primary" onPointerDown={(e) => { e.preventDefault(); flap(); }}><Sparkles size={18} /> Flap</button>}
      footnote="Space / tap the sky to flap · pigs give +25"
    >
      <canvas ref={canvasRef} className="arcade-canvas" onPointerDown={(e) => { e.preventDefault(); flap(); }} />
    </GameShell>
  );
}
