import { createClient } from '@supabase/supabase-js';

// Ozone Play's own Supabase project (OZONE CASH QUEST). Public anon key, safe in client code.
const supabaseUrl = 'https://grkppyxvyojtygqxevwz.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdya3BweXh2eW9qdHlncXhldnd6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0MzQ0OTEsImV4cCI6MjEwODAxMDQ5MX0.VLzb1MsqRcTEsa8NvejpEBkCjhGq3LtzbxCvQ_CPwRU';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Product = {
  id: string;
  name: string;
  sparks: number;
  price_cents: number;
  tagline: string | null;
  sort_order: number;
};

export type Wallet = {
  id: string;
  player_id: string;
  sparks: number;
  lifetime_sparks: number;
  cashable_sparks?: number;
};

const PLAYER_ID_KEY = 'ozone_player_id';

export function getOrCreatePlayerId(userId?: string): string {
  const storageKey = userId ? `${PLAYER_ID_KEY}_${userId}` : PLAYER_ID_KEY;
  let id = localStorage.getItem(storageKey);
  if (!id) {
    id = `p_${crypto.randomUUID()}`;
    localStorage.setItem(storageKey, id);
  }
  return id;
}

export async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, sparks, price_cents, tagline, sort_order')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchWallet(playerId: string): Promise<Wallet | null> {
  const { data, error } = await supabase
    .from('wallet')
    .select('id, player_id, sparks, lifetime_sparks, cashable_sparks')
    .eq('player_id', playerId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function ensureWallet(playerId: string): Promise<Wallet> {
  const existing = await fetchWallet(playerId);
  if (existing) return existing;
  const { data, error } = await supabase
    .from('wallet')
    .insert({ player_id: playerId, sparks: 0, lifetime_sparks: 0 })
    .select('id, player_id, sparks, lifetime_sparks, cashable_sparks')
    .single();
  if (error) throw error;
  return data;
}

export async function startCheckout(productId: string, playerId: string): Promise<string> {
  const url = `${supabaseUrl}/functions/v1/create-checkout`;
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? supabaseAnonKey}`,
    },
    body: JSON.stringify({ productId, playerId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Checkout failed (${res.status})`);
  }
  const body = (await res.json()) as { url?: string; error?: string };
  if (!body.url) throw new Error(body.error ?? 'No checkout URL returned');
  return body.url;
}

export async function creditSparks(playerId: string, delta: number, reason: string, reference?: string) {
  // Balances are changed only by the server, which validates and caps every reward.
  const { error } = await supabase.rpc('apply_spark_event', {
    p_player_id: playerId,
    p_reason: reason,
    p_delta: Math.round(delta),
    p_ref: reference ?? null,
  });
  if (error) throw error;
}

export type Subscription = {
  id: string;
  status: string;
  plan: string;
  current_period_end: string | null;
};

export type WalkSession = {
  id: string;
  started_at: string;
  ended_at: string | null;
  steps: number;
  distance_m: number;
  sparks_earned: number;
  status: string;
};

export async function fetchSubscription(): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('id, status, plan, current_period_end')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function startSubscriptionCheckout(): Promise<string> {
  const url = `${supabaseUrl}/functions/v1/create-checkout`;
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? supabaseAnonKey}`,
    },
    body: JSON.stringify({ mode: 'subscription' }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Subscription failed (${res.status})`);
  }
  const body = (await res.json()) as { url?: string; error?: string };
  if (!body.url) throw new Error(body.error ?? 'No checkout URL returned');
  return body.url;
}

export async function openBillingPortal(): Promise<string> {
  const url = `${supabaseUrl}/functions/v1/create-checkout`;
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? supabaseAnonKey}`,
    },
    body: JSON.stringify({ mode: 'billing_portal' }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Portal failed (${res.status})`);
  }
  const body = (await res.json()) as { url?: string; error?: string };
  if (!body.url) throw new Error(body.error ?? 'No portal URL returned');
  return body.url;
}

export async function fetchActiveWalkSession(): Promise<WalkSession | null> {
  const { data, error } = await supabase
    .from('walk_sessions')
    .select('id, started_at, ended_at, steps, distance_m, sparks_earned, status')
    .eq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function startWalkSession(): Promise<WalkSession> {
  const { data, error } = await supabase
    .from('walk_sessions')
    .insert({ status: 'active' })
    .select('id, started_at, ended_at, steps, distance_m, sparks_earned, status')
    .single();
  if (error) throw error;
  return data;
}

export async function updateWalkSession(id: string, steps: number, distanceM: number): Promise<void> {
  await supabase
    .from('walk_sessions')
    .update({ steps, distance_m: distanceM })
    .eq('id', id);
}

export async function endWalkSession(id: string, sparksEarned: number): Promise<void> {
  await supabase
    .from('walk_sessions')
    .update({
      status: 'completed',
      ended_at: new Date().toISOString(),
      sparks_earned: sparksEarned,
    })
    .eq('id', id);
}

export type Withdrawal = {
  id: string;
  sparks_used: number;
  amount_cents: number;
  status: string;
  created_at: string;
  processed_at: string | null;
};

export async function requestWithdrawal(sparksToRedeem: number, method: string, handle: string): Promise<{ id: string }> {
  const { data, error } = await supabase.rpc('request_withdrawal', {
    sparks_to_redeem: sparksToRedeem,
    p_method: method,
    p_handle: handle,
  });
  if (error) throw error;
  return { id: data as string };
}

export async function fetchWithdrawals(limit = 10): Promise<Withdrawal[]> {
  const { data, error } = await supabase
    .from('withdrawals')
    .select('id, sparks_used, amount_cents, status, created_at, processed_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function fetchWalkHistory(limit = 10): Promise<WalkSession[]> {
  const { data, error } = await supabase
    .from('walk_sessions')
    .select('id, started_at, ended_at, steps, distance_m, sparks_earned, status')
    .eq('status', 'completed')
    .order('ended_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}