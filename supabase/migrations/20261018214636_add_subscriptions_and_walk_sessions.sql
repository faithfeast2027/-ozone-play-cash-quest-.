/*
# Add subscriptions and walk sessions for Walk & Earn

## Overview
Introduces a membership tier and a walk-and-earn feature. Subscribed members
can start live walking sessions in the browser; each session tracks steps
(distance travelled) and converts completed distance into sparks credited to
the member's wallet.

## New Tables

### subscriptions
- id (uuid, primary key)
- user_id (uuid, owner, defaults to auth.uid())
- stripe_customer_id (text, nullable) - Stripe customer reference
- stripe_subscription_id (text, nullable, unique) - Stripe subscription id
- status (text) - 'active', 'canceled', 'past_due', 'trialing', 'inactive'
- plan (text) - 'walk_earn_monthly' for now
- current_period_end (timestamptz, nullable) - renewal date
- created_at (timestamptz)
- updated_at (timestamptz)

### walk_sessions
- id (uuid, primary key)
- user_id (uuid, owner, defaults to auth.uid())
- started_at (timestamptz)
- ended_at (timestamptz, nullable)
- steps (integer, default 0) - simulated steps counted during the session
- distance_m (integer, default 0) - distance in meters
- sparks_earned (integer, default 0) - sparks credited when session ended
- status (text, default 'active') - 'active', 'completed', 'abandoned'

## Security
- RLS enabled on both tables.
- subscriptions: owner-scoped CRUD for authenticated users.
- walk_sessions: owner-scoped CRUD for authenticated users.
- Only the owning user can read, create, update, or end their own sessions and
  subscription record.
*/

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id text,
  stripe_subscription_id text UNIQUE,
  status text NOT NULL DEFAULT 'inactive',
  plan text NOT NULL DEFAULT 'walk_earn_monthly',
  current_period_end timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_subscription" ON subscriptions;
CREATE POLICY "select_own_subscription" ON subscriptions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_subscription" ON subscriptions;
CREATE POLICY "insert_own_subscription" ON subscriptions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_subscription" ON subscriptions;
CREATE POLICY "update_own_subscription" ON subscriptions FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_subscription" ON subscriptions;
CREATE POLICY "delete_own_subscription" ON subscriptions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS walk_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  steps integer NOT NULL DEFAULT 0,
  distance_m integer NOT NULL DEFAULT 0,
  sparks_earned integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE walk_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_walk_sessions" ON walk_sessions;
CREATE POLICY "select_own_walk_sessions" ON walk_sessions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_walk_sessions" ON walk_sessions;
CREATE POLICY "insert_own_walk_sessions" ON walk_sessions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_walk_sessions" ON walk_sessions;
CREATE POLICY "update_own_walk_sessions" ON walk_sessions FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_walk_sessions" ON walk_sessions;
CREATE POLICY "delete_own_walk_sessions" ON walk_sessions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_walk_sessions_user ON walk_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
