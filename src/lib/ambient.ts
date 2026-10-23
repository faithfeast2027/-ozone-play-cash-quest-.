// Calming generative ambience: soft chord pad + gentle filtered "breeze". No percussion.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let timer: number | null = null;

export type AmbientTrackId = 'breeze' | 'night' | 'dream';
type Track = { id: AmbientTrackId; name: string; blurb: string; chords: number[][]; breeze: number; cutoff: number; every: number };
export const AMBIENT_TRACKS: Track[] = [
  { id: 'breeze', name: 'Calm Breeze', blurb: 'Soft pads + gentle wind', chords: [[220, 277.18, 329.63], [196, 246.94, 293.66], [174.61, 220, 261.63], [196, 261.63, 329.63]], breeze: 0.35, cutoff: 900, every: 8000 },
  { id: 'night', name: 'Night Drive', blurb: 'Deep minor chords, low hum', chords: [[110, 130.81, 164.81], [98, 116.54, 146.83], [87.31, 110, 130.81], [98, 123.47, 146.83]], breeze: 0.12, cutoff: 600, every: 9000 },
  { id: 'dream', name: 'Dream Pop', blurb: 'Airy major-7 shimmer', chords: [[261.63, 329.63, 392, 493.88], [220, 277.18, 329.63, 415.3], [174.61, 220, 261.63, 329.63], [196, 246.94, 293.66, 369.99]], breeze: 0.2, cutoff: 1500, every: 7000 },
];
const TRACK_KEY = 'ozone_ambient_track';
export function getAmbientTrack(): AmbientTrackId { try { const t = localStorage.getItem(TRACK_KEY) as AmbientTrackId | null; return t && AMBIENT_TRACKS.some((x) => x.id === t) ? t : 'breeze'; } catch { return 'breeze'; } }
export function setAmbientTrack(id: AmbientTrackId) {
  try { localStorage.setItem(TRACK_KEY, id); } catch { /* ignore */ }
  if (ctx) { stopAmbient(); startAmbient(); }
}

export function isAmbientOn() { return !!ctx; }

export function startAmbient() {
  if (ctx) return;
  const track = AMBIENT_TRACKS.find((t) => t.id === getAmbientTrack()) ?? AMBIENT_TRACKS[0];
  const CHORDS = track.chords;
  ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  master.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 3);

  // breeze: looping noise through a slowly swept low-pass
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 250;
  lfo.connect(lfoGain).connect(lp.frequency);
  const ng = ctx.createGain(); ng.gain.value = track.breeze;
  noise.connect(lp).connect(ng).connect(master);
  noise.start(); lfo.start();

  let i = 0;
  const playChord = () => {
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    CHORDS[i++ % CHORDS.length].forEach((f, k) => {
      const o = ctx!.createOscillator(); o.type = k === 0 ? 'sine' : 'triangle'; o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 8;
      const g = ctx!.createGain(); g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.27 / CHORDS[0].length, t + 3); g.gain.linearRampToValueAtTime(0, t + 9.5);
      const f2 = ctx!.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = track.cutoff;
      o.connect(f2).connect(g).connect(master!); o.start(t); o.stop(t + 10);
    });
  };
  playChord();
  timer = window.setInterval(playChord, track.every);
}

export function stopAmbient() {
  if (!ctx) return;
  const c = ctx; const m = master;
  if (timer) window.clearInterval(timer);
  timer = null; ctx = null; master = null;
  if (m) m.gain.linearRampToValueAtTime(0, c.currentTime + 1);
  window.setTimeout(() => c.close(), 1200);
}
