// Short synthesized game sound effects (WebAudio, no files) + haptics.
// Separate from the calming ambience in ambient.ts; muted with the header SFX toggle.
// Players pick a sound pack (Classic, Retro 8-bit, Soft Chime, Bubbly Pop, or Off) and a volume
// in Settings; every game and the Ozone mascot call the same `sfx.*` API, so they all follow it.
import { useSyncExternalStore } from 'react';

const KEY = 'ozone_sfx';
const PACK_KEY = 'ozone_sfx_pack';
const VOL_KEY = 'ozone_sfx_volume';

export type SoundPackId = 'classic' | 'retro' | 'chime' | 'bubbly' | 'off';
export type SoundPack = { id: SoundPackId; name: string; blurb: string; emoji: string };
export const SOUND_PACKS: SoundPack[] = [
  { id: 'classic', name: 'Classic Arcade', blurb: 'Bright, punchy coin-op blips', emoji: '🕹️' },
  { id: 'retro', name: 'Retro 8-bit', blurb: 'Chiptune squares, crunchy and quick', emoji: '👾' },
  { id: 'chime', name: 'Soft Chime', blurb: 'Lo-fi bells, gentle and warm', emoji: '🔔' },
  { id: 'bubbly', name: 'Bubbly Pop', blurb: 'Bouncy bloops and pops', emoji: '🫧' },
  { id: 'off', name: 'Off', blurb: 'No game sounds or vibration', emoji: '🔇' },
];
const PACK_IDS = SOUND_PACKS.map((p) => p.id);

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

let on = read(KEY) !== '0';
let pack: SoundPackId = (() => { const p = read(PACK_KEY) as SoundPackId | null; return p && PACK_IDS.includes(p) ? p : 'classic'; })();
let lastAudible: Exclude<SoundPackId, 'off'> = pack === 'off' ? 'classic' : pack;
let volume = (() => { const v = parseFloat(read(VOL_KEY) ?? ''); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8; })();
let override: SoundPackId | null = null; // used by previews
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let lofi: BiquadFilterNode | null = null;
let version = 0;
const listeners = new Set<() => void>();
const emit = () => { version++; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** True when game sounds are audible (not muted and pack is not Off). */
export function isSfxOn() { return on && pack !== 'off'; }
export function setSfxOn(next: boolean) {
  on = next;
  if (next && pack === 'off') { pack = lastAudible; write(PACK_KEY, pack); }
  write(KEY, next ? '1' : '0');
  emit();
}
export function useSfxOn() { return useSyncExternalStore(subscribe, () => on && pack !== 'off'); }

export function getSoundPack() { return pack; }
export function setSoundPack(next: SoundPackId) {
  pack = next;
  if (next !== 'off') { lastAudible = next; if (!on) { on = true; write(KEY, '1'); } }
  write(PACK_KEY, next);
  emit();
}
export function getSfxVolume() { return volume; }
export function setSfxVolume(v: number) {
  volume = Math.min(1, Math.max(0, v));
  write(VOL_KEY, String(volume));
  if (master && ctx) master.gain.setTargetAtTime(0.4 * volume, ctx.currentTime, 0.02);
  emit();
}
export function useSoundSettings() {
  useSyncExternalStore(subscribe, () => version);
  return { pack, volume, on: on && pack !== 'off' };
}

const activePack = (): SoundPackId => override ?? pack;

function audio(force = false) {
  if (!force && (!on || pack === 'off')) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.4 * volume; master.connect(ctx.destination);
      lofi = ctx.createBiquadFilter(); lofi.type = 'lowpass'; lofi.frequency.value = 2600; lofi.Q.value = 0.4; lofi.connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch { return null; }
}

type ToneOpts = { f: number; to?: number; dur?: number; type?: OscillatorType; vol?: number; delay?: number };
let forcing = false;
function rawTone(c: AudioContext, out: AudioNode, { f, to, dur = 0.12, type = 'sine', vol = 0.5, delay = 0 }: ToneOpts, attack = 0.008) {
  const t = c.currentTime + delay;
  const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(Math.max(20, f), t);
  if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.03);
}
const semis = (f: number) => 440 * Math.pow(2, Math.round(12 * Math.log2(f / 440)) / 12);

/** Pack-aware voice: the same musical gesture, rendered in each pack's character. */
function tone(opts: ToneOpts) {
  const c = audio(forcing); if (!c || !master || !lofi) return;
  const p = activePack();
  if (p === 'off') return;
  const vol = opts.vol ?? 0.5; const dur = opts.dur ?? 0.12;
  if (p === 'classic') { rawTone(c, master, opts); return; }
  if (p === 'retro') {
    const f = semis(opts.f); const to = opts.to ? semis(opts.to) : undefined;
    rawTone(c, master, { ...opts, f, to, type: 'square', dur: Math.max(0.04, dur * 0.8), vol: Math.min(0.14, vol * 0.7) }, 0.002);
    return;
  }
  if (p === 'chime') {
    const d = Math.min(1.2, dur * 3 + 0.18);
    rawTone(c, lofi, { ...opts, type: 'sine', dur: d, vol: vol * 0.55, to: opts.to ? opts.f + (opts.to - opts.f) * 0.3 : undefined }, 0.012);
    rawTone(c, lofi, { ...opts, f: opts.f * 2.01, to: undefined, type: 'sine', dur: d * 0.6, vol: vol * 0.16 }, 0.006);
    return;
  }
  // bubbly: rounded sine bloops that bend upward
  const f = opts.f * 1.12;
  rawTone(c, master, { ...opts, f, to: opts.to ? opts.to * 1.12 : f * 1.7, type: 'sine', dur: Math.max(0.06, dur * 0.9), vol: vol * 0.9 }, 0.004);
}

let noiseBuf: AudioBuffer | null = null;
function noise(dur = 0.18, vol = 0.4, freq = 900, delay = 0) {
  const c = audio(forcing); if (!c || !master || !lofi) return;
  const p = activePack();
  if (p === 'off') return;
  if (p === 'bubbly') { tone({ f: Math.min(900, freq / 3), to: Math.min(1800, freq / 1.4), dur: Math.min(0.14, dur), vol: vol * 0.5, delay }); return; }
  if (p === 'retro') { // crunchy stepped "noise" via fast detuned squares
    for (let i = 0; i < 3; i++) rawTone(c, master, { f: 120 + Math.random() * freq * 0.4, dur: Math.min(0.06, dur / 3), type: 'square', vol: Math.min(0.08, vol * 0.25), delay: delay + i * 0.03 }, 0.002);
    return;
  }
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const soft = p === 'chime';
  const t = c.currentTime + delay;
  const s = c.createBufferSource(); s.buffer = noiseBuf;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(soft ? freq * 0.35 : freq, t); f.frequency.exponentialRampToValueAtTime(80, t + dur);
  const g = c.createGain(); g.gain.setValueAtTime(soft ? vol * 0.3 : vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(soft ? lofi : master); s.start(t); s.stop(t + dur + 0.02);
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
  /** Walk & Earn milestone coin "ching ching" (coin-style in every pack). */
  ching() {
    const p = activePack();
    const notes = p === 'chime' ? [1046.5, 1568] : p === 'bubbly' ? [1318.5, 1760] : [1568, 2093, 3136];
    [0, 0.16].forEach((d) => notes.forEach((f, i) => tone({ f, dur: 0.35, type: i === 0 ? 'square' : 'sine', vol: i === 0 ? 0.08 : 0.15, delay: d })));
  },
  /** Ozone's little "voice": a bouncy two-note chirp. */
  mascot(mood: 'happy' | 'boop' | 'squish' = 'happy') {
    if (mood === 'squish') { tone({ f: 520, to: 260, dur: 0.16, type: 'triangle', vol: 0.22 }); tone({ f: 300, to: 620, dur: 0.14, type: 'sine', vol: 0.16, delay: 0.14 }); return; }
    if (mood === 'boop') { tone({ f: 700, to: 940, dur: 0.07, type: 'sine', vol: 0.18 }); return; }
    tone({ f: 587, to: 784, dur: 0.09, type: 'triangle', vol: 0.18 }); tone({ f: 880, to: 1175, dur: 0.12, type: 'sine', vol: 0.16, delay: 0.09 });
  },
};

/** Plays a short demo of a pack at the current volume, even if a different pack is selected. */
export function previewSoundPack(id: SoundPackId) {
  if (id === 'off') return;
  const prev = override; const prevForce = forcing;
  override = id; forcing = true;
  try {
    sfx.coin(2);
    setTimeout(() => { override = id; forcing = true; sfx.jump(); override = prev; forcing = prevForce; }, 220);
    setTimeout(() => { override = id; forcing = true; sfx.pop(true); override = prev; forcing = prevForce; }, 440);
    setTimeout(() => { override = id; forcing = true; sfx.win(); override = prev; forcing = prevForce; }, 680);
  } finally { override = prev; forcing = prevForce; }
}

/** Call from a user gesture (tap) so iOS/Safari allows later sounds, e.g. GPS-driven ones. */
export function unlockAudio() { audio(); }

export function haptic(pattern: number | number[] = 12) {
  try { if (on && pack !== 'off' && 'vibrate' in navigator) navigator.vibrate(pattern); } catch { /* unsupported */ }
}
