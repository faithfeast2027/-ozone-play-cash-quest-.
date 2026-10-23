// @ts-nocheck -- node:crypto/Buffer types (@types/node) are not installed in this repo; logic is covered by a local encrypt/decrypt + JWT verify test.
// Vercel serverless function (Node runtime): Web Push sender. No npm deps: VAPID (ES256 JWT) and
// RFC 8291 aes128gcm payload encryption are implemented with node:crypto.
//
// GET  /api/push-send                       -> { publicKey }   (VAPID public key for subscribing)
// POST /api/push-send { kind: 'broadcast', category, title, body, url? }   admin only (JWT email)
//   -> { sent, failed, removed }
// POST /api/push-send { kind: 'crew', messageId }   caller must be the message's sender
//   -> pushes "new crew message" to the other crew members who have crew notifications on.
//
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from 'node:crypto';

type Req = { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown };
type Res = { status: (code: number) => Res; json: (body: unknown) => void; setHeader: (k: string, v: string) => void };

const env: Record<string, string | undefined> = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SUPABASE_URL = env.SUPABASE_URL || 'https://grkppyxvyojtygqxevwz.supabase.co';
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
const ADMIN_EMAIL = 'odrich217@gmail.com';
const CATEGORIES = ['quests', 'crew', 'drops', 'rewards'] as const;
type Category = (typeof CATEGORIES)[number];

export type PushSub = { id?: string; user_id?: string; endpoint: string; p256dh: string; auth: string };

// ---------------- Web Push primitives ----------------
const b64u = (b: Buffer) => b.toString('base64url');
const fromB64u = (s: string) => Buffer.from(s, 'base64url');
const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();

/** RFC 8291 + RFC 8188 (aes128gcm), single record. */
export function encryptPayload(sub: { p256dh: string; auth: string }, payload: Buffer, salt = randomBytes(16)) {
  const uaPublic = fromB64u(sub.p256dh);
  const authSecret = fromB64u(sub.auth);
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, ct]);
}

export function vapidAuth(endpoint: string, publicKey: string, privateKey: string, subject: string) {
  const pub = fromB64u(publicKey);
  const key = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
  const head = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${publicKey}`;
}

async function sendOne(sub: PushSub, data: object): Promise<number> {
  const body = encryptPayload(sub, Buffer.from(JSON.stringify(data)));
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
      Authorization: vapidAuth(sub.endpoint, env.VAPID_PUBLIC_KEY || '', env.VAPID_PRIVATE_KEY || '', env.VAPID_SUBJECT || `mailto:${ADMIN_EMAIL}`),
    },
    body,
  });
  return r.status;
}

// ---------------- Supabase (service role REST) ----------------
export async function sb(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
  });
}

async function getUser(token: string): Promise<{ id: string; email?: string } | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_KEY } });
    if (!r.ok) return null;
    const u = (await r.json()) as { id?: string; email?: string };
    return u?.id ? { id: u.id, email: u.email } : null;
  } catch { return null; }
}

export async function deliver(subs: PushSub[], data: object) {
  let sent = 0, failed = 0, removed = 0;
  const gone: string[] = [];
  const queue = [...subs];
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      try {
        const status = await sendOne(s, data);
        if (status >= 200 && status < 300) sent++;
        else { failed++; if (status === 404 || status === 410) gone.push(s.endpoint); }
      } catch { failed++; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, subs.length) }, worker));
  for (const ep of gone) {
    const r = await sb(`push_subscriptions?endpoint=eq.${encodeURIComponent(ep)}`, { method: 'DELETE' });
    if (r.ok) removed++;
  }
  return { sent, failed, removed };
}

const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');
function header(req: Req, name: string) { const v = req.headers[name.toLowerCase()]; return Array.isArray(v) ? v[0] : v; }

// Per-instance rate limit for crew pushes.
const recent = new Map<string, number[]>();
function limited(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const list = (recent.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now); recent.set(key, list);
  return list.length > max;
}
const notified = new Set<string>();

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ publicKey: env.VAPID_PUBLIC_KEY || null });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  if (!SERVICE_KEY || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return res.status(503).json({ error: 'Push not configured' });

  const auth = header(req, 'authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const user = token ? await getUser(token) : null;
  if (!user) return res.status(401).json({ error: 'Sign in first' });

  let body: Record<string, unknown> = {};
  try { body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body as Record<string, unknown>)) ?? {}; } catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  try {
    if (body.kind === 'broadcast') {
      if ((user.email ?? '').toLowerCase() !== ADMIN_EMAIL) return res.status(403).json({ error: 'Admins only' });
      const category = body.category as Category;
      if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Pick a category' });
      const title = clean(body.title, 80); const text = clean(body.body, 240);
      if (!title || !text) return res.status(400).json({ error: 'Add a title and message' });
      const url = typeof body.url === 'string' && body.url.startsWith('/') ? body.url.slice(0, 200) : '/';
      const r = await sb(`push_subscriptions?select=endpoint,p256dh,auth&prefs->>${category}=eq.true&limit=5000`);
      if (!r.ok) return res.status(502).json({ error: 'Could not load subscribers' });
      const subs = (await r.json()) as PushSub[];
      const out = await deliver(subs, { title, body: text, url, tag: `ozone-${category}`, category });
      return res.status(200).json({ ...out, total: subs.length });
    }

    if (body.kind === 'crew') {
      const messageId = typeof body.messageId === 'string' && /^[0-9a-f-]{36}$/i.test(body.messageId) ? body.messageId : '';
      if (!messageId) return res.status(400).json({ error: 'messageId required' });
      if (notified.has(messageId)) return res.status(200).json({ sent: 0, duplicate: true });
      if (limited(`crew:${user.id}`, 20, 60_000)) return res.status(429).json({ error: 'Too many notifications' });
      const mr = await sb(`crew_messages?select=id,crew_id,user_id,username,body,is_bot,created_at&id=eq.${messageId}`);
      const msg = ((await mr.json().catch(() => [])) as { id: string; crew_id: string; user_id: string; username: string | null; body: string; is_bot: boolean; created_at: string }[])[0];
      if (!msg || msg.is_bot || msg.user_id !== user.id) return res.status(403).json({ error: 'Not your message' });
      if (Date.now() - new Date(msg.created_at).getTime() > 5 * 60_000) return res.status(200).json({ sent: 0, stale: true });
      notified.add(messageId);
      if (notified.size > 5000) notified.clear();
      const [cr, mem] = await Promise.all([
        sb(`crews?select=name&id=eq.${msg.crew_id}`),
        sb(`crew_members?select=user_id&crew_id=eq.${msg.crew_id}&user_id=neq.${user.id}`),
      ]);
      const crewName = ((await cr.json().catch(() => [])) as { name: string }[])[0]?.name || 'Your crew';
      const ids = ((await mem.json().catch(() => [])) as { user_id: string }[]).map((m) => m.user_id);
      if (!ids.length) return res.status(200).json({ sent: 0 });
      const sr = await sb(`push_subscriptions?select=endpoint,p256dh,auth&prefs->>crew=eq.true&user_id=in.(${ids.join(',')})`);
      const subs = (await sr.json().catch(() => [])) as PushSub[];
      const out = await deliver(subs, { title: `${crewName} · ${msg.username || 'Crew'}`, body: clean(msg.body, 140), url: '/?chat=crew', tag: `crew-${msg.crew_id}`, category: 'crew' });
      return res.status(200).json(out);
    }

    return res.status(400).json({ error: 'Unknown kind' });
  } catch (e) {
    console.error('push-send error', e);
    return res.status(500).json({ error: 'Push failed' });
  }
}
