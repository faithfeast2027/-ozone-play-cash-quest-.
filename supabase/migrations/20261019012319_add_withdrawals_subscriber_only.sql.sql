/*
# Add subscriber-gated withdrawals

## Overview
Introduces a withdrawal flow that lets players redeem earned sparks for cash
payouts. Withdrawals are ONLY available to players with an active subscription;
the check is enforced server-side inside a SECURITY DEFINER function so a
non-subscriber cannot bypass it by calling the data API directly.

## New Tables

### withdrawals
- id (uuid, primary key)
- user_id (uuid, owner, defaults to auth.uid())
- sparks_used (integer, not null) — sparks redeemed for this payout
- amount_cents (integer, not null) — payout value in cents
- status (text, default 'pending') — pending | paid | rejected
- created_at (timestamptz)
- processed_at (timestamptz, nullable)

## New Functions

### request_withdrawal(sparks_to_redeem integer)
SECURITY DEFINER function that:
1. Verifies the caller (auth.uid()) has an active subscription whose
   current_period_end is in the future (or null with status 'active').
2. Loads the caller's wallet and confirms the spark balance covers the
   requested amount.
3. Atomically debits the wallet and inserts a withdrawals row.
4. Records a ledger entry with reason 'withdrawal'.
Returns the new withdrawal row id.

The subscription check is server-side and cannot be forged by the client.

## Security
- RLS enabled on withdrawals; owner-scoped SELECT only (no direct INSERT /
  UPDATE / DELETE from the client — those go through the function).
- EXECUTE on request_withdrawal revoked from anon; granted to authenticated.
- The function runs as its owner (bypasses RLS) but authorizes the caller
  inside the body before any write.

## Important Notes
1. Only active subscribers can withdraw. Non-subscribers receive a clear error.
2. The spark debit and withdrawal insert happen in a single PL/pgSQL block so
   a partial failure cannot debit sparks without recording the withdrawal.
3. No existing columns or rows are modified or deleted.
*/

CREATE TABLE IF NOT EXISTS withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  sparks_used integer NOT NULL,
  amount_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_withdrawals" ON withdrawals;
CREATE POLICY "select_own_withdrawals" ON withdrawals FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id);

CREATE OR REPLACE FUNCTION request_withdrawal(sparks_to_redeem integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_sub record;
  v_wallet record;
  v_amount_cents integer;
  v_withdrawal_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to request a withdrawal.';
  END IF;

  IF sparks_to_redeem IS NULL OR sparks_to_redeem < 100 THEN
    RAISE EXCEPTION 'Minimum withdrawal is 100 sparks.';
  END IF;

  SELECT status, current_period_end INTO v_sub
  FROM subscriptions
  WHERE user_id = v_user
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND OR v_sub.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Only active subscribers can withdraw. Subscribe to unlock cashouts.';
  END IF;

  IF v_sub.current_period_end IS NOT NULL AND v_sub.current_period_end < now() THEN
    RAISE EXCEPTION 'Your subscription has expired. Renew to withdraw.';
  END IF;

  SELECT id, sparks INTO v_wallet
  FROM wallet
  WHERE user_id = v_user
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No wallet found for your account.';
  END IF;

  IF v_wallet.sparks < sparks_to_redeem THEN
    RAISE EXCEPTION 'Insufficient spark balance.';
  END IF;

  -- 1 spark = 1 cent for this preview payout model
  v_amount_cents := sparks_to_redeem;

  UPDATE wallet
  SET sparks = sparks - sparks_to_redeem,
      updated_at = now()
  WHERE id = v_wallet.id;

  INSERT INTO withdrawals (user_id, sparks_used, amount_cents)
  VALUES (v_user, sparks_to_redeem, v_amount_cents)
  RETURNING id INTO v_withdrawal_id;

  INSERT INTO spark_ledger (wallet_id, delta, reason, reference)
  VALUES (v_wallet.id, -sparks_to_redeem, 'withdrawal', v_withdrawal_id::text);

  RETURN v_withdrawal_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION request_withdrawal FROM anon;
GRANT EXECUTE ON FUNCTION request_withdrawal TO authenticated;
