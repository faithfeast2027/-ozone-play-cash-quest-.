// Daily quests + player level/XP. Stored per signed-in user in localStorage (no DB tables).
// Rewards are NON-cashable sparks, credited through the same server RPC path the arcade games use.
import { useEffect, useSyncExternalStore } from 'react';
import { creditSparks } from '@/lib/supabase';

export type GameId = 'spark_run' | 'temple' | 'floppy' | 'nyc' | 'mancala' | 'drunk' | 'livemap';

export const GAME_NAMES: Record<GameId, string> = {
  spark_run: 'Spark Run',
  temple: 'Temple Mario Run',
  floppy: 'Floppy Angry Bird',
  nyc: 'NYC Star Crush',
  mancala: 'Mancala Island',
  drunk: 'Drunk Tea Diamond',
  livemap: 'Live Map',
};

type DailyStats = {
  plays: Partial<Record<GameId, number>>;
  best: Partial<Record<GameId, number>>;
  wins: Partial<Record<GameId, number>>;
};

type DailyState = { date: string; stats: DailyStats; claimed: string[]; chestClaimed: boolean };
type XpState = { xp: number; rewardedLevel: number };

export type QuestIcon = 'zap' | 'coins' | 'bird' | 'star' | 'shell' | 'map' | 'compass' | 'flame';
export type QuestDef = {
  id: string;
  title: string;
  detail: string;
  total: number;
  reward: number;
  icon: QuestIcon;
  game: GameId | 'any';
  measure: (s: DailyStats) => number;
};

export type QuestView = QuestDef & { progress: number; done: boolean; claimed: boolean };

// Every reward stays at or below 120 so it fits the smallest per-reason server cap.
const QUEST_POOL: QuestDef[] = [
  { id: 'spark_score', title: 'Spark Sprinter', detail: 'Score 400 in one Spark Run', total: 400, reward: 60, icon: 'zap', game: 'spark_run', measure: (s) => s.best.spark_run ?? 0 },
  { id: 'spark_play', title: 'Lane Changer', detail: 'Finish 3 Spark Runs', total: 3, reward: 50, icon: 'zap', game: 'spark_run', measure: (s) => s.plays.spark_run ?? 0 },
  { id: 'nyc_score', title: 'Skyline Guardian', detail: 'Score 500 in NYC Star Crush', total: 500, reward: 70, icon: 'star', game: 'nyc', measure: (s) => s.best.nyc ?? 0 },
  { id: 'nyc_play', title: 'Night Shift', detail: 'Play 2 rounds of NYC Star Crush', total: 2, reward: 45, icon: 'star', game: 'nyc', measure: (s) => s.plays.nyc ?? 0 },
  { id: 'temple_score', title: 'Temple Dash', detail: 'Score 300 in Temple Mario Run', total: 300, reward: 60, icon: 'coins', game: 'temple', measure: (s) => s.best.temple ?? 0 },
  { id: 'temple_play', title: 'Ruin Runner', detail: 'Finish 2 Temple Mario Runs', total: 2, reward: 40, icon: 'coins', game: 'temple', measure: (s) => s.plays.temple ?? 0 },
  { id: 'floppy_score', title: 'High Flyer', detail: 'Score 90 in Floppy Angry Bird', total: 90, reward: 60, icon: 'bird', game: 'floppy', measure: (s) => s.best.floppy ?? 0 },
  { id: 'mancala_win', title: 'Tide Turner', detail: 'Win a Mancala Island match', total: 1, reward: 100, icon: 'shell', game: 'mancala', measure: (s) => s.wins.mancala ?? 0 },
  { id: 'drop_collect', title: 'First Signal', detail: 'Collect a drop on the Live Map', total: 1, reward: 80, icon: 'map', game: 'livemap', measure: (s) => s.plays.livemap ?? 0 },
  { id: 'variety3', title: 'Arcade Hopper', detail: 'Play 3 different games', total: 3, reward: 70, icon: 'compass', game: 'any', measure: (s) => distinctGames(s) },
  { id: 'variety5', title: 'Full Circuit', detail: 'Play 5 different games', total: 5, reward: 110, icon: 'flame', game: 'any', measure: (s) => distinctGames(s) },
];

export const CHEST_REWARD = 100;
export const QUEST_XP = 50;
export const CHEST_XP = 150;

function distinctGames(s: DailyStats) {
  return (Object.keys(s.plays) as GameId[]).filter((g) => g !== 'livemap' && (s.plays[g] ?? 0) > 0).length;
}

export function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** 3 quests per day, picked deterministically from the date; never two for the same game. */
export function questsForDate(date: string): QuestDef[] {
  let seed = hash(`ozone-quests-${date}`);
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const pool = [...QUEST_POOL];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const picked: QuestDef[] = [];
  const games = new Set<string>();
  for (const q of pool) {
    if (games.has(q.game)) continue;
    picked.push(q); games.add(q.game);
    if (picked.length === 3) break;
  }
  return picked;
}

// ---------- Level curve ----------
export function xpToNext(level: number) { return 100 + (level - 1) * 60; }
export function levelFromXp(xp: number) {
  let level = 1; let rest = Math.max(0, Math.floor(xp));
  while (rest >= xpToNext(level)) { rest -= xpToNext(level); level++; }
  return { level, into: rest, need: xpToNext(level) };
}
export function levelReward(level: number) { return Math.min(100, 15 + level * 5); }

const XP_DIVISOR: Record<GameId, number> = { spark_run: 10, temple: 8, floppy: 3, nyc: 12, mancala: 1, drunk: 1, livemap: 1 };
export function xpForRun(game: GameId, score: number, won: boolean) {
  if (game === 'drunk') return 8;
  if (game === 'livemap') return 25;
  if (game === 'mancala') return Math.min(90, 20 + Math.floor(score) + (won ? 40 : 0));
  return Math.max(5, Math.min(80, Math.round(10 + score / XP_DIVISOR[game])));
}

// ---------- Store ----------
let userId = 'guest';
let daily: DailyState = emptyDaily();
let xpState: XpState = { xp: 0, rewardedLevel: 1 };
let levelUps: number[] = [];
let snapshot: ProgressSnapshot = buildSnapshot();
const listeners = new Set<() => void>();

function emptyDaily(): DailyState { return { date: localDateKey(), stats: { plays: {}, best: {}, wins: {} }, claimed: [], chestClaimed: false }; }
const dailyKey = () => `ozone_daily_${userId}`;
const xpKey = () => `ozone_xp_${userId}`;

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(dailyKey()) || 'null') as DailyState | null;
    daily = d && d.date === localDateKey() ? { ...emptyDaily(), ...d, stats: { plays: d.stats?.plays ?? {}, best: d.stats?.best ?? {}, wins: d.stats?.wins ?? {} } } : emptyDaily();
  } catch { daily = emptyDaily(); }
  try {
    const x = JSON.parse(localStorage.getItem(xpKey()) || 'null') as XpState | null;
    xpState = x && typeof x.xp === 'number' ? { xp: x.xp, rewardedLevel: x.rewardedLevel ?? levelFromXp(x.xp).level } : { xp: 0, rewardedLevel: 1 };
  } catch { xpState = { xp: 0, rewardedLevel: 1 }; }
}

function save() {
  try { localStorage.setItem(dailyKey(), JSON.stringify(daily)); localStorage.setItem(xpKey(), JSON.stringify(xpState)); } catch { /* storage full */ }
}

function emit() { snapshot = buildSnapshot(); listeners.forEach((l) => l()); }

function rollDay() {
  if (daily.date !== localDateKey()) { daily = emptyDaily(); save(); return true; }
  return false;
}

export type ProgressSnapshot = {
  date: string;
  quests: QuestView[];
  doneCount: number;
  allDone: boolean;
  chestClaimed: boolean;
  xp: number;
  level: number;
  into: number;
  need: number;
  pendingLevelUp: number | null;
  unclaimedLevelRewards: number[];
};

function buildSnapshot(): ProgressSnapshot {
  const quests = questsForDate(daily.date).map((q) => {
    const progress = Math.min(q.total, q.measure(daily.stats));
    return { ...q, progress, done: progress >= q.total, claimed: daily.claimed.includes(q.id) };
  });
  const lv = levelFromXp(xpState.xp);
  const unclaimed: number[] = [];
  for (let l = xpState.rewardedLevel + 1; l <= lv.level; l++) unclaimed.push(l);
  return {
    date: daily.date,
    quests,
    doneCount: quests.filter((q) => q.done).length,
    allDone: quests.every((q) => q.claimed),
    chestClaimed: daily.chestClaimed,
    xp: xpState.xp,
    level: lv.level,
    into: lv.into,
    need: lv.need,
    pendingLevelUp: levelUps[0] ?? null,
    unclaimedLevelRewards: unclaimed,
  };
}

export function setProgressUser(id: string | undefined | null) {
  const next = id || 'guest';
  if (next === userId && snapshot) return;
  userId = next; levelUps = []; load(); emit();
}

function addXp(amount: number) {
  const before = levelFromXp(xpState.xp).level;
  xpState.xp += Math.max(0, Math.round(amount));
  const after = levelFromXp(xpState.xp).level;
  for (let l = before + 1; l <= after; l++) levelUps.push(l);
}

export type RunReport = { xpGained: number; level: number; leveledUp: boolean; questsCompleted: string[] };

/** Called by every game when a run/match finishes (or a drop is collected). */
export function reportGameResult(game: GameId, score: number, won = false): RunReport {
  rollDay();
  const before = buildSnapshot().quests.filter((q) => q.done).map((q) => q.id);
  const s = daily.stats;
  s.plays[game] = (s.plays[game] ?? 0) + 1;
  s.best[game] = Math.max(s.best[game] ?? 0, Math.floor(score));
  if (won) s.wins[game] = (s.wins[game] ?? 0) + 1;
  const lvBefore = levelFromXp(xpState.xp).level;
  const xpGained = xpForRun(game, score, won);
  addXp(xpGained);
  save(); emit();
  const after = snapshot.quests.filter((q) => q.done).map((q) => q.id);
  return { xpGained, level: snapshot.level, leveledUp: snapshot.level > lvBefore, questsCompleted: after.filter((id) => !before.includes(id)) };
}

// Arcade reasons the server accepts for positive rewards (non-cashable). We fall back across them
// because the server rate-limits each reason to one reward per 20 seconds.
const ARCADE_REASONS = ['spark_run_game', 'temple_mario_run', 'floppy_angry_bird', 'nyc_star_crush', 'mancala_island'];
const REASON_FOR_GAME: Partial<Record<GameId, string>> = { spark_run: 'spark_run_game', temple: 'temple_mario_run', floppy: 'floppy_angry_bird', nyc: 'nyc_star_crush', mancala: 'mancala_island' };

async function creditArcade(playerId: string, amount: number, ref: string, prefer?: string) {
  const order = prefer ? [prefer, ...ARCADE_REASONS.filter((r) => r !== prefer)] : ARCADE_REASONS;
  let lastErr: unknown = null;
  for (const reason of order) {
    try { await creditSparks(playerId, amount, reason, ref); return; } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
      if (!/slow down/i.test(msg)) break;
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String((lastErr as { message?: string })?.message ?? 'Could not add sparks.');
  throw new Error(/limit/i.test(msg) ? 'Daily game reward limit reached. Come back tomorrow.' : /slow down/i.test(msg) ? 'Give it a few seconds and claim again.' : msg);
}

const inFlight = new Set<string>();

export async function claimQuest(playerId: string, questId: string) {
  rollDay();
  const q = snapshot.quests.find((x) => x.id === questId);
  if (!q || !q.done || q.claimed || inFlight.has(questId)) return false;
  inFlight.add(questId);
  try {
    await creditArcade(playerId, q.reward, `quest:${daily.date}:${q.id}`, q.game !== 'any' ? REASON_FOR_GAME[q.game as GameId] : undefined);
    daily.claimed = [...daily.claimed, q.id];
    addXp(QUEST_XP);
    save(); emit();
    return true;
  } finally { inFlight.delete(questId); }
}

export async function claimChest(playerId: string) {
  rollDay();
  if (!snapshot.allDone || daily.chestClaimed || inFlight.has('chest')) return false;
  inFlight.add('chest');
  try {
    await creditArcade(playerId, CHEST_REWARD, `quest_chest:${daily.date}`);
    daily.chestClaimed = true;
    addXp(CHEST_XP);
    save(); emit();
    return true;
  } finally { inFlight.delete('chest'); }
}

export async function claimLevelReward(playerId: string, level: number) {
  if (level !== xpState.rewardedLevel + 1 || level > snapshot.level || inFlight.has('lvl')) return false;
  inFlight.add('lvl');
  try {
    await creditArcade(playerId, levelReward(level), `level_up:${level}`);
    xpState.rewardedLevel = level;
    save(); emit();
    return true;
  } finally { inFlight.delete('lvl'); }
}

export function dismissLevelUp() { levelUps.shift(); emit(); }

function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
function getSnapshot() { return snapshot; }

export function useProgress(): ProgressSnapshot {
  const snap = useSyncExternalStore(subscribe, getSnapshot);
  // Reset at local midnight even if the app stays open.
  useEffect(() => {
    const t = window.setInterval(() => { if (rollDay()) emit(); }, 30000);
    const onVis = () => { if (rollDay()) emit(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  return snap;
}

load(); snapshot = buildSnapshot();
