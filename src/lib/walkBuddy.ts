// Walk buddy: members (any Walk & Earn plan, from $7.99) pick one character to walk and explore with.
// Saved on the account (Supabase user metadata) so it follows the player across devices, cached locally for instant paint.
import { supabase, fetchSubscription, type Subscription } from '@/lib/supabase';
import { characterById, isPersonaId, type PersonaId } from '@/lib/characters';

const CACHE_KEY = 'ozone_walk_buddy';

export function cachedBuddy(): PersonaId | null {
  try { const v = localStorage.getItem(CACHE_KEY); return isPersonaId(v) ? v : null; } catch { return null; }
}

export async function loadBuddy(): Promise<PersonaId | null> {
  const { data } = await supabase.auth.getUser();
  const v = data.user?.user_metadata?.walk_buddy;
  if (isPersonaId(v)) { try { localStorage.setItem(CACHE_KEY, v); } catch { /* ignore */ } return v; }
  return cachedBuddy();
}

export async function saveBuddy(id: PersonaId): Promise<void> {
  try { localStorage.setItem(CACHE_KEY, id); } catch { /* ignore */ }
  const { error } = await supabase.auth.updateUser({ data: { walk_buddy: id } });
  if (error) throw error;
}

export const isActiveMember = (s: Subscription | null) =>
  !!s && s.status === 'active' && (!s.current_period_end || new Date(s.current_period_end) > new Date());

/** The buddy to show on walks/map/AR: only for active members who picked one. */
export async function loadActiveBuddy(): Promise<PersonaId | null> {
  try {
    const [sub, buddy] = await Promise.all([fetchSubscription(), loadBuddy()]);
    return isActiveMember(sub) ? buddy : null;
  } catch { return null; }
}

type Moment = 'start' | 'milestone' | 'finish' | 'map' | 'ar' | 'collect' | 'idle';
const LINES: Record<PersonaId, Record<Moment, string[]>> = {
  ozone: {
    start: ["Let's gooo! Every step's a spark.", 'Field mode on. I got you.'],
    milestone: ['Ching ching! Keep that pace!', "You're cooking out here!"],
    finish: ['W walk. Sparks banked!', 'That was clean. Same time tomorrow?'],
    map: ["Let's find some drops around here.", 'Who owns that plot? Let\'s check in.'],
    ar: ['Look around, gems are hiding!', 'Point me at the sparkle!'],
    collect: ['GOT IT! 💎', "That's ours now!"],
    idle: ['Ready when you are.', 'Tap Start and we roll.'],
  },
  volt: {
    start: ['Zap! Let\'s move, fast and clean.', 'Charging up. Go go go!'],
    milestone: ['⚡ Speed boost! Keep it humming.', 'Voltage rising, don\'t stop now!'],
    finish: ['Fully charged. Sparks locked in.', 'Lightning run. Respect.'],
    map: ['Fastest route to a drop? I\'m on it.', 'Sprint to that next spot!'],
    ar: ['Scanning the grid… gems nearby!', 'Turn quick, I sense voltage!'],
    collect: ['⚡ Zapped it!', 'Too fast for them!'],
    idle: ['Batteries full. Let\'s run.', 'Say the word and we bolt.'],
  },
  ember: {
    start: ['Streak on fire. Let\'s keep it lit 🔥', 'Warm up, we burn bright today.'],
    milestone: ['🔥 That streak is blazing!', 'Hotter every step!'],
    finish: ['Streak kept. Proud of you.', 'Embers glowing. Rest up, champ.'],
    map: ['Let\'s light up this map.', 'Every check-in feeds the flame.'],
    ar: ['I see a glow out there…', 'Follow the heat, gem ahead!'],
    collect: ['🔥 Burned it in!', 'Into the fire, into the wallet!'],
    idle: ['Don\'t let the streak cool off.', 'One walk keeps the fire going.'],
  },
  nova: {
    start: ['Plotting the optimal route… go.', 'Steady pace wins the cosmos ✨'],
    milestone: ['✨ Milestone mapped. On target.', 'Orbit stable. Keep going.'],
    finish: ['Mission complete. Sparks secured.', 'Stellar walk. Data says you\'re improving.'],
    map: ['Nearest drop is the smart play.', 'Let\'s chart today\'s best spots.'],
    ar: ['Aligning stars… gem in view soon.', 'Sweep slowly, I\'ll read the sky.'],
    collect: ['✨ Collected. Precise.', 'Another star for the map.'],
    idle: ['Strategy first, then steps.', 'Ready to launch when you are.'],
  },
};

export function buddyLine(id: PersonaId, moment: Moment): string {
  const pool = LINES[id][moment];
  return pool[Math.floor(Math.random() * pool.length)];
}
export { characterById };
export type { Moment as BuddyMoment };
