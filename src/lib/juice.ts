// Canvas helpers shared by the arcade games: DPR-aware sizing, delta-time loop, particles,
// floating score popups, screen shake, image cache, and a few drawing utilities.

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export type Stage = { ctx: CanvasRenderingContext2D; w: number; h: number; dpr: number };

/** Sizes the canvas backing store to its CSS box × devicePixelRatio (capped at 3). */
export function fitCanvas(canvas: HTMLCanvasElement): Stage {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, dpr };
}

/** requestAnimationFrame loop with clamped delta time (seconds). Return false from fn to stop. */
export function startLoop(fn: (dt: number, now: number) => boolean | void) {
  let raf = 0; let last = performance.now(); let alive = true;
  const step = (now: number) => {
    if (!alive) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (fn(dt, now) === false) { alive = false; return; }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => { alive = false; cancelAnimationFrame(raf); };
}

type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; g: number; shape: 'dot' | 'spark' | 'ring' };
export class Particles {
  list: P[] = [];
  private reduced = prefersReducedMotion();
  burst(x: number, y: number, color: string, n = 14, speed = 220, opts: { gravity?: number; size?: number; shape?: P['shape'] } = {}) {
    const count = this.reduced ? Math.ceil(n / 3) : n;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2; const s = speed * (0.35 + Math.random() * 0.75);
      const max = 0.45 + Math.random() * 0.4;
      this.list.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: max, max, size: (opts.size ?? 3) * (0.6 + Math.random() * 0.8), color, g: opts.gravity ?? 380, shape: opts.shape ?? (i % 3 === 0 ? 'spark' : 'dot') });
    }
    if (!this.reduced) this.list.push({ x, y, vx: 0, vy: 0, life: 0.35, max: 0.35, size: 6, color, g: 0, shape: 'ring' });
    if (this.list.length > 400) this.list.splice(0, this.list.length - 400);
  }
  trail(x: number, y: number, color: string, size = 3) {
    if (this.reduced) return;
    this.list.push({ x, y, vx: -40 - Math.random() * 40, vy: (Math.random() - 0.5) * 30, life: 0.35, max: 0.35, size, color, g: 0, shape: 'dot' });
  }
  update(dt: number) {
    for (const p of this.list) { p.life -= dt; p.vy += p.g * dt; p.vx *= 0.985; p.x += p.vx * dt; p.y += p.vy * dt; }
    this.list = this.list.filter((p) => p.life > 0);
  }
  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.list) {
      const k = p.life / p.max;
      ctx.globalAlpha = Math.max(0, k);
      if (p.shape === 'ring') {
        ctx.strokeStyle = p.color; ctx.lineWidth = 3 * k;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size + (1 - k) * 34, 0, Math.PI * 2); ctx.stroke();
      } else if (p.shape === 'spark') {
        ctx.strokeStyle = p.color; ctx.lineWidth = p.size * 0.7; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke();
      } else {
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.4 + k * 0.6), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }
  clear() { this.list = []; }
}

type Pop = { x: number; y: number; text: string; color: string; life: number; max: number; size: number };
export class Popups {
  list: Pop[] = [];
  add(x: number, y: number, text: string, color = '#fff', size = 18) {
    this.list.push({ x, y, text, color, life: 0.9, max: 0.9, size });
    if (this.list.length > 30) this.list.shift();
  }
  update(dt: number) { for (const p of this.list) { p.life -= dt; p.y -= 46 * dt; } this.list = this.list.filter((p) => p.life > 0); }
  draw(ctx: CanvasRenderingContext2D) {
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of this.list) {
      const t = 1 - p.life / p.max;
      const scale = t < 0.15 ? 0.6 + (t / 0.15) * 0.55 : 1.15 - Math.min(0.15, (t - 0.15) * 0.4);
      ctx.globalAlpha = Math.min(1, p.life / 0.3);
      ctx.font = `800 ${Math.round(p.size * scale)}px ${ROUNDED}`;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }
  clear() { this.list = []; }
}

export class Shake {
  t = 0; mag = 0; private reduced = prefersReducedMotion();
  add(mag: number, dur = 0.3) { if (this.reduced) return; this.mag = Math.max(this.mag, mag); this.t = Math.max(this.t, dur); }
  update(dt: number) { this.t = Math.max(0, this.t - dt); if (this.t === 0) this.mag = 0; }
  apply(ctx: CanvasRenderingContext2D) {
    if (!this.t) return;
    const m = this.mag * Math.min(1, this.t / 0.3);
    ctx.translate((Math.random() - 0.5) * 2 * m, (Math.random() - 0.5) * 2 * m);
  }
}

export const ROUNDED = `ui-rounded, 'SF Pro Rounded', 'Nunito', 'Space Grotesk', system-ui, sans-serif`;

const imgCache = new Map<string, HTMLImageElement>();
export function loadImage(src: string) {
  let img = imgCache.get(src);
  if (!img) { img = new Image(); img.src = src; imgCache.set(src, img); }
  return img;
}

/** Character avatar: circular image with gradient ring + glow. */
export function drawAvatar(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, r: number, ring = '#b9f17b', rot = 0) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  ctx.shadowColor = ring; ctx.shadowBlur = 18;
  const g = ctx.createLinearGradient(-r, -r, r, r); g.addColorStop(0, ring); g.addColorStop(1, '#ffffff');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
  if (img.complete && img.naturalWidth) {
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) * 0.2, s, s, -r, -r, r * 2, r * 2);
  } else { ctx.fillStyle = '#26363b'; ctx.fillRect(-r, -r, r * 2, r * 2); }
  const shine = ctx.createLinearGradient(0, -r, 0, r); shine.addColorStop(0, 'rgba(255,255,255,.28)'); shine.addColorStop(0.5, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine; ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.restore();
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr); ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr); ctx.arcTo(x, y, x + w, y, rr); ctx.closePath();
}

export function drawGem(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c1: string, c2: string, t = 0) {
  ctx.save(); ctx.translate(x, y); ctx.scale(Math.cos(t * 3) * 0.25 + 0.85, 1);
  ctx.shadowColor = c1; ctx.shadowBlur = 14;
  const g = ctx.createLinearGradient(-r, -r, r, r); g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.85, -r * 0.2); ctx.lineTo(0, r); ctx.lineTo(-r * 0.85, -r * 0.2); ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.35, -r * 0.2); ctx.lineTo(-r * 0.35, -r * 0.2); ctx.closePath(); ctx.fill();
  ctx.restore();
}

export function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t = 0) {
  const sx = Math.abs(Math.cos(t * 4)) * 0.7 + 0.3;
  ctx.save(); ctx.translate(x, y); ctx.scale(sx, 1);
  ctx.shadowColor = '#ffd76a'; ctx.shadowBlur = 12;
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#fff7c2'); g.addColorStop(0.5, '#ffd34d'); g.addColorStop(1, '#c98a12');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(140,90,0,.55)'; ctx.lineWidth = Math.max(1, r * 0.14);
  ctx.beginPath(); ctx.arc(0, 0, r * 0.66, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t: number) => { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
