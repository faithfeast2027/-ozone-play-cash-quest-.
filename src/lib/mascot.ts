// Ozone, the on-screen buddy: settings store (visible / minimized / position) + a tiny event bus
// so any part of the app can make Ozone talk or cheer without prop drilling.
import { useSyncExternalStore } from 'react';

const VIS_KEY = 'ozone_mascot_visible';
const MIN_KEY = 'ozone_mascot_min';
const POS_KEY = 'ozone_mascot_pos';

export type MascotPos = { x: number; y: number }; // fractions of the free viewport area (0..1)
export type MascotMood = 'happy' | 'hype' | 'wink' | 'sleepy';
export type MascotMessage = { id: number; text: string; mood: MascotMood };
export type CheerKind = 'levelUp' | 'chest' | 'quest' | 'streak' | 'win';

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

let visible = read(VIS_KEY) !== '0';
let minimized = read(MIN_KEY) === '1';
let pos: MascotPos | null = (() => { try { const p = JSON.parse(read(POS_KEY) ?? 'null'); return p && typeof p.x === 'number' && typeof p.y === 'number' ? p : null; } catch { return null; } })();
let snapshot = { visible, minimized, pos };
const listeners = new Set<() => void>();
const emit = () => { snapshot = { visible, minimized, pos }; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useMascotSettings() { return useSyncExternalStore(subscribe, () => snapshot); }
export function setMascotVisible(v: boolean) { visible = v; if (v) minimized = false; write(VIS_KEY, v ? '1' : '0'); write(MIN_KEY, minimized ? '1' : '0'); emit(); }
export function setMascotMinimized(m: boolean) { minimized = m; write(MIN_KEY, m ? '1' : '0'); emit(); }
export function setMascotPos(p: MascotPos | null) { pos = p; if (p) write(POS_KEY, JSON.stringify(p)); else { try { localStorage.removeItem(POS_KEY); } catch { /* ignore */ } } emit(); }

// ---- speech bus ----
let msgId = 0;
const msgListeners = new Set<(m: MascotMessage) => void>();
export function onMascotMessage(fn: (m: MascotMessage) => void) { msgListeners.add(fn); return () => { msgListeners.delete(fn); }; }
export function mascotSay(text: string, mood: MascotMood = 'happy') { const m = { id: ++msgId, text, mood }; msgListeners.forEach((l) => l(m)); }

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const CHEERS: Record<CheerKind, string[]> = {
  levelUp: ['LEVEL UP! You\'re cooking now 🔥', 'New level unlocked. Big moves!', 'Level up! The field fears you.'],
  chest: ['Chest cracked open! Stack those sparks 💎', 'Bonus chest = secured. Legend.', 'All quests done AND the chest? Clean sweep!'],
  quest: ['Quest claimed! Keep that streak alive.', 'Sparks in the bag ✨', 'Another one down. Who\'s next?'],
  streak: ['Daily bonus locked in. See you tomorrow!', 'Streak growing. Don\'t break the chain!'],
  win: ['W! That run was clean.', 'You made that look easy.'],
};
export function mascotCheer(kind: CheerKind) { mascotSay(pick(CHEERS[kind]), kind === 'quest' || kind === 'streak' ? 'happy' : 'hype'); }

export const TIP_LINES = [
  'Tip: finish all 3 daily quests to open the bonus chest.',
  'Tip: Live Map and Walk & Earn sparks are the cash-eligible ones.',
  'Combos stack fast in Spark Run. Chain those coins!',
  'Unlock Volt, Ember, or Nova for faster runs.',
  'Drag me anywhere. I\'ll remember the spot.',
  'Pick a sound pack you like in Settings 🎧',
  'Quests reset at midnight. Get yours in!',
];
export const TAP_LINES = ['Hey hey! 👋', 'Boop! That tickles.', 'Ozone in the building!', 'Let\'s get these sparks.', 'Stay charged ⚡', 'You got this.'];
export { pick as pickLine };
