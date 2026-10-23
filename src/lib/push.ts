import { supabase } from '@/lib/supabase';

export type PushPrefs = { quests: boolean; crew: boolean; drops: boolean; rewards: boolean };
export const DEFAULT_PREFS: PushPrefs = { quests: true, crew: true, drops: true, rewards: true };
export const PUSH_CATEGORIES: { id: keyof PushPrefs; label: string; blurb: string }[] = [
  { id: 'quests', label: 'Daily quests reminder', blurb: 'A nudge when new quests drop' },
  { id: 'crew', label: 'Crew messages', blurb: 'When your crew chats' },
  { id: 'drops', label: 'New Live Map drops', blurb: 'Fresh spots to earn near you' },
  { id: 'rewards', label: 'Level & chest rewards', blurb: 'Rewards waiting to be claimed' },
];

// VAPID public key (public by design). The env value wins; the constant is a fallback for local builds.
const FALLBACK_VAPID = 'BLJTRqPm93lJqPxTNRqseX47He9q4beZHuO3nFLhlbY9NyLsOyzRYaLjl59k6VCi6wOhFcvjxy_FvkYhQ2v9vQ8';
const PREFS_KEY = 'ozone_push_prefs';

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export function loadPrefs(): PushPrefs {
  try { return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<PushPrefs>) }; } catch { return { ...DEFAULT_PREFS }; }
}
function storePrefs(p: PushPrefs) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ } }

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => { /* not fatal */ });
}

function keyBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function vapidKey(): Promise<string> {
  const fromEnv = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim();
  if (fromEnv) return fromEnv;
  try { const r = await fetch('/api/push-send'); const b = (await r.json()) as { publicKey?: string }; if (b.publicKey) return b.publicKey; } catch { /* ignore */ }
  return FALLBACK_VAPID;
}

async function registration() {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (!existing) await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

async function save(sub: PushSubscription, prefs: PushPrefs) {
  const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_prefs: prefs, p_user_agent: navigator.userAgent.slice(0, 300),
  });
  if (error) throw new Error(error.message);
}

/** Ask permission, subscribe this device, and save it for the signed-in player. */
export async function enablePush(prefs: PushPrefs): Promise<void> {
  if (!pushSupported()) throw new Error(isIOS() && !isStandalone() ? 'On iPhone, add Ozone Play to your Home Screen first, then turn notifications on from there.' : 'This browser does not support push notifications.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked. Allow them in your browser or phone settings.' : 'Notifications were not allowed.');
  const reg = await registration();
  const key = keyBytes(await vapidKey());
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); }
    catch { const old = await reg.pushManager.getSubscription(); await old?.unsubscribe(); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); }
  }
  await save(sub, prefs);
  storePrefs(prefs);
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe().catch(() => false);
}

export async function updatePushPrefs(prefs: PushPrefs): Promise<void> {
  storePrefs(prefs);
  const sub = await currentSubscription();
  if (sub) await save(sub, prefs);
}

/** Admin broadcast (server checks the caller is the admin). */
export async function sendBroadcast(category: keyof PushPrefs, title: string, body: string, url = '/') {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/api/push-send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
    body: JSON.stringify({ kind: 'broadcast', category, title, body, url }),
  });
  const out = (await res.json().catch(() => ({}))) as { sent?: number; failed?: number; removed?: number; total?: number; error?: string };
  if (!res.ok) throw new Error(out.error || `Send failed (${res.status})`);
  return out;
}
