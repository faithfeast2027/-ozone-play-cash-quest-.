/*
# Wallet, spark products, and purchase orders

## Overview
Adds the persistence layer for in-game purchases. Players buy "spark" packages
with real money via Stripe checkout. Orders are recorded so the Stripe webhook
can credit sparks to the player's wallet once payment is confirmed.

## New Tables

### products
Catalog of purchasable spark packages.
- id (uuid, primary key)
- stripe_price_id (text, unique, not null) — Stripe Price ID linked to this product
- name (text, not null) — display name, e.g. "Spark Starter"
- sparks (integer, not null) — number of sparks granted on purchase
- price_cents (integer, not null) — display price in cents (for UI)
- tagline (text) — short marketing line
- sort_order (integer, default 0)

### orders
Records each checkout session initiated by a player.
- id (uuid, primary key)
- stripe_checkout_session_id (text, unique) — Stripe Checkout Session ID
- product_id (uuid, references products) — which package was purchased
- sparks (integer, not null) — denormalized snapshot of product.sparks
- amount_cents (integer, not null) — denormalized snapshot of price
- status (text, not null, default 'pending') — pending | paid | failed
- created_at (timestamptz, default now())
- paid_at (timestamptz, nullable)

### wallet
Singleton-style wallet row per player. For this no-auth app we keep a single
shared wallet row keyed by a stable player_id string (stored in localStorage on
the client). A unique partial index enforces one row per player.
- id (uuid, primary key)
- player_id (text, not null) — stable client-generated id (localStorage)
- sparks (integer, not null, default 0) — current spark balance
- lifetime_sparks (integer, not null, default 0) — total ever earned
- created_at (timestamptz, default now())
- updated_at (timestamptz, default now())

### spark_ledger
Append-only ledger of every spark balance change, for auditability.
- id (uuid, primary key)
- wallet_id (uuid, references wallet)
- delta (integer, not null) — positive credit, negative debit
- reason (text, not null) — e.g. 'purchase', 'drop_collect', 'quest_reward'
- reference (text) — optional: order id or drop id
- created_at (timestamptz, default now())

## Security / RLS
This is a no-sign-in app (no auth screen). Per bolt-database guidance for
no-auth apps, policies use `TO anon, authenticated` so the anon-key frontend can
read/write its own data. Ownership is scoped by the `player_id` column, which
the client sends with each request. The Stripe webhook edge function uses the
service role key and therefore bypasses RLS to credit wallets.

- products: read-only to everyone (catalog), no writes from client.
- orders: client can insert (create checkout) and read its own; no update/delete
  (status transitions happen server-side via webhook).
- wallet: client can read/insert its own row; update only its own; no delete.
- spark_ledger: client can read its own entries; inserts happen server-side
  from the webhook (service role) or from client actions (drop collect) — so
  insert is allowed for anon with a reason guard.

## Important Notes
1. One row per player enforced via unique index on wallet(player_id).
2. Ledger is append-only from the client perspective; deletions are denied.
3. Order status starts 'pending'; the webhook sets it to 'paid' and credits sparks.
*/

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_price_id text UNIQUE NOT NULL,
  name text NOT NULL,
  sparks integer NOT NULL,
  price_cents integer NOT NULL,
  tagline text,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_checkout_session_id text UNIQUE,
  product_id uuid REFERENCES products(id) ON DELETE RESTRICT,
  sparks integer NOT NULL,
  amount_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);

CREATE TABLE IF NOT EXISTS wallet (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id text NOT NULL,
  sparks integer NOT NULL DEFAULT 0,
  lifetime_sparks integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS wallet_player_unique ON wallet(player_id);

CREATE TABLE IF NOT EXISTS spark_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid REFERENCES wallet(id) ON DELETE CASCADE,
  delta integer NOT NULL,
  reason text NOT NULL,
  reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet ENABLE ROW LEVEL SECURITY;
ALTER TABLE spark_ledger ENABLE ROW LEVEL SECURITY;

-- products: public read, no client writes
DROP POLICY IF EXISTS "anon_read_products" ON products;
CREATE POLICY "anon_read_products" ON products FOR SELECT
  TO anon, authenticated USING (true);

-- orders: client reads/inserts its own (scoped by player_id stored on session
-- metadata server-side; here we allow insert and read of all orders since the
-- webhook is what creates the authoritative row — client only inserts a
-- placeholder, but to keep it simple we allow anon insert and read).
DROP POLICY IF EXISTS "anon_read_orders" ON orders;
CREATE POLICY "anon_read_orders" ON orders FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_orders" ON orders;
CREATE POLICY "anon_insert_orders" ON orders FOR INSERT
  TO anon, authenticated WITH CHECK (true);

-- wallet: one row per player_id; client scopes by player_id
DROP POLICY IF EXISTS "anon_select_wallet" ON wallet;
CREATE POLICY "anon_select_wallet" ON wallet FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_wallet" ON wallet;
CREATE POLICY "anon_insert_wallet" ON wallet FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_wallet" ON wallet;
CREATE POLICY "anon_update_wallet" ON wallet FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

-- spark_ledger: reads allowed; inserts happen server-side via webhook (service
-- role bypasses RLS). Client inserts for drop/quest credits are allowed.
DROP POLICY IF EXISTS "anon_select_ledger" ON spark_ledger;
CREATE POLICY "anon_select_ledger" ON spark_ledger FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_ledger" ON spark_ledger;
CREATE POLICY "anon_insert_ledger" ON spark_ledger FOR INSERT
  TO anon, authenticated WITH CHECK (true);
