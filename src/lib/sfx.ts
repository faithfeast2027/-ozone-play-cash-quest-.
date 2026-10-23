// Short synthesized game sound effects (WebAudio, no files) + haptics.
// Separate from the calming ambience in ambient.ts; muted with the header SFX toggle.
import { useSyncExternalStore } from 'react';

const KEY = 'ozone_sfx';
let on = (() => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } })();
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const listeners = new Set<() => void>();

export function isSfxOn() { return on; }
export function setSfxOn(next: boolean) {
  on = next;
  try { localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}
export function useSfxOn() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => on);
}

function audio() {
  if (!on) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.32; master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch { return null; }
}

type ToneOpts = { f: number; to?: number; dur?: number; type?: OscillatorType; vol?: number; delay?: number };
function tone({ f, to, dur = 0.12, type = 'sine', vol = 0.5, delay = 0 }: ToneOpts) {
  const c = audio(); if (!c || !master) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}

let noiseBuf: AudioBuffer | null = null;
function noise(dur = 0.18, vol = 0.4, freq = 900, delay = 0) {
  const c = audio(); if (!c || !master) return;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + delay;
  const s = c.createBufferSource(); s.buffer = noiseBuf;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(80, t + dur);
  const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + dur + 0.02);
}

export const sfx = {
  coin(pitch = 0) { const b = 880 * Math.pow(2, Math.min(pitch, 12) / 24); tone({ f: b, dur: 0.07, type: 'square', vol: 0.12 }); tone({ f: b * 1.5, dur: 0.12, type: 'square', vol: 0.1, delay: 0.06 }); },
  hit() { noise(0.28, 0.5, 1400); tone({ f: 180, to: 50, dur: 0.3, type: 'sawtooth', vol: 0.25 }); },
  jump() { tone({ f: 320, to: 720, dur: 0.14, type: 'triangle', vol: 0.3 }); },
  flap() { tone({ f: 420, to: 640, dur: 0.08, type: 'triangle', vol: 0.22 }); noise(0.06, 0.12, 2400); },
  shoot() { tone({ f: 1200, to: 380, dur: 0.08, type: 'square', vol: 0.07 }); },
  pop(big = false) { noise(big ? 0.22 : 0.12, big ? 0.35 : 0.22, big ? 2200 : 3200); tone({ f: big ? 520 : 760, to: big ? 1040 : 1400, dur: 0.1, type: 'sine', vol: 0.18 }); },
  whoosh() { noise(0.2, 0.18, 1800); },
  combo(n: number) { const b = 523.25 * Math.pow(2, (n % 12) / 12); [0, 4, 7].forEach((s, i) => tone({ f: b * Math.pow(2, s / 12), dur: 0.12, type: 'triangle', vol: 0.16, delay: i * 0.05 })); },
  start() { [0, 7, 12].forEach((s, i) => tone({ f: 392 * Math.pow(2, s / 12), dur: 0.14, type: 'triangle', vol: 0.2, delay: i * 0.07 })); },
  over() { [12, 7, 3, 0].forEach((s, i) => tone({ f: 261.6 * Math.pow(2, s / 12), dur: 0.2, type: 'triangle', vol: 0.18, delay: i * 0.1 })); },
  win() { [0, 4, 7, 12, 16].forEach((s, i) => tone({ f: 523.25 * Math.pow(2, s / 12), dur: 0.22, type: 'triangle', vol: 0.18, delay: i * 0.08 })); },
  levelUp() { [0, 4, 7, 12, 7, 12, 16, 19].forEach((s, i) => tone({ f: 392 * Math.pow(2, s / 12), dur: 0.2, type: i % 2 ? 'square' : 'triangle', vol: 0.13, delay: i * 0.075 })); },
  claim() { tone({ f: 988, dur: 0.08, type: 'square', vol: 0.1 }); tone({ f: 1318, dur: 0.18, type: 'square', vol: 0.1, delay: 0.07 }); },
  tick() { tone({ f: 1500, dur: 0.025, type: 'square', vol: 0.05 }); },
  tap() { tone({ f: 660, dur: 0.05, type: 'sine', vol: 0.18 }); },
};

export function haptic(pattern: number | number[] = 12) {
  try { if (on && 'vibrate' in navigator) navigator.vibrate(pattern); } catch { /* unsupported */ }
}
