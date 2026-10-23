// @ts-nocheck -- shares node:crypto helpers with push-send.ts
// Vercel Cron: automatic pushes. Called by Vercel with Authorization: Bearer $CRON_SECRET.
// GET /api/push-cron?job=morning  -> daily quests + new drops (quests / drops prefs)
// GET /api/push-cron?job=streak   -> streak reminder for players who claimed yesterday (ET) but not today
import { deliver, sb, type PushSub } from './push-send';

type Req = { method?: string; headers: Record<string, string | string[] | undefined>; query?: Record<string, string | string[]>; url?: string };
type Res = { status: (code: number) => Res; json: (body: unknown) => void; setHeader: (k: string, v: string) => void };
const env: Record<string, string | undefined> = (globalThis as any).process?.env ?? {};

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const MORNING = [
  { title: 'New daily quests are live ⚡', body: 'Fresh quests just dropped. Knock them out for sparks and XP.' },
  { title: 'Ozone checking in ✨', body: 'Your daily quests reset. New drops are waiting on the Live Map.' },
  { title: 'Rise and grind 💎', body: 'New quests and city drops are up. Go stack some sparks.' },
];
const STREAK = [
  { title: '🔥 Keep your streak alive', body: 'You have not claimed today’s bonus yet. Tap to keep the chain going.' },
  { title: 'Don’t break the chain 🔥', body: 'Your daily bonus is waiting. Claim it before midnight.' },
  { title: 'Ozone misses you ✨', body: 'One tap saves your streak and grows tomorrow’s bonus.' },
];

function etDay(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

async function json<T>(r: Response): Promise<T> { return (await r.json().catch(() => [])) as T; }

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store');
  const auth = (Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization) ?? '';
  if (!env.CRON_SECRET || auth !== `Bearer ${env.CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorized' });
  const job = (req.query?.job as string) || new URL(req.url || '/', 'http://x').searchParams.get('job') || '';

  try {
    if (job === 'morning') {
      const subs = await json<PushSub[]>(await sb('push_subscriptions?select=endpoint,p256dh,auth&or=(prefs->>quests.eq.true,prefs->>drops.eq.true)&limit=5000'));
      const msg = pick(MORNING);
      const out = await deliver(subs, { ...msg, url: '/', tag: 'ozone-daily', category: 'quests' });
      return res.status(200).json({ job, ...out, total: subs.length });
    }
    if (job === 'streak') {
      const today = etDay(0), yesterday = etDay(-1);
      const [y, t] = await Promise.all([
        json<{ user_id: string; streak: number }[]>(await sb(`daily_bonus_claims?select=user_id,streak&day=eq.${yesterday}&limit=5000`)),
        json<{ user_id: string }[]>(await sb(`daily_bonus_claims?select=user_id&day=eq.${today}&limit=5000`)),
      ]);
      const done = new Set(t.map((r) => r.user_id));
      const atRisk = y.filter((r) => !done.has(r.user_id));
      if (!atRisk.length) return res.status(200).json({ job, sent: 0, atRisk: 0 });
      const ids = atRisk.map((r) => r.user_id);
      let sent = 0, failed = 0, removed = 0;
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const subs = await json<(PushSub & { user_id: string })[]>(await sb(`push_subscriptions?select=user_id,endpoint,p256dh,auth&prefs->>quests=eq.true&user_id=in.(${chunk.join(',')})`));
        for (const s of subs) {
          const days = atRisk.find((r) => r.user_id === s.user_id)?.streak ?? 1;
          const m = pick(STREAK);
          const o = await deliver([s], { title: days > 1 ? `🔥 ${days}-day streak on the line` : m.title, body: m.body, url: '/', tag: 'ozone-streak', category: 'quests' });
          sent += o.sent; failed += o.failed; removed += o.removed;
        }
      }
      return res.status(200).json({ job, sent, failed, removed, atRisk: atRisk.length });
    }
    return res.status(400).json({ error: 'Unknown job' });
  } catch (e) {
    console.error('push-cron error', e);
    return res.status(500).json({ error: 'Cron failed' });
  }
}
