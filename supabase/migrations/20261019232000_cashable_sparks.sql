/*
# Only server-verified earnings can be cashed out
- wallet.cashable_sparks: the part of the balance earned through server-verified
  actions (Live Map check-ins and plot visit rewards). Purchased sparks and
  client-reported game sparks are playable but never withdrawable.
- Trigger: only privileged (SECURITY DEFINER / service) code may raise
  cashable_sparks; it is always clamped to <= sparks, so spending uses up
  cashable sparks last only when needed.
- request_withdrawal now checks and deducts cashable_sparks.
*/
ALTER TABLE wallet ADD COLUMN IF NOT EXISTS cashable_sparks integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION guard_cashable_sparks() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN NEW.cashable_sparks := 0; END IF;
  ELSIF NEW.cashable_sparks > OLD.cashable_sparks AND current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    NEW.cashable_sparks := OLD.cashable_sparks;
  END IF;
  NEW.cashable_sparks := GREATEST(LEAST(NEW.cashable_sparks, NEW.sparks), 0);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_cashable ON wallet;
CREATE TRIGGER trg_guard_cashable BEFORE INSERT OR UPDATE ON wallet FOR EACH ROW EXECUTE FUNCTION guard_cashable_sparks();

CREATE OR REPLACE FUNCTION credit_wallet_for_user(p_user uuid, p_delta integer, p_reason text, p_ref text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wallet_id uuid;
BEGIN
  SELECT id INTO v_wallet_id FROM wallet WHERE user_id = p_user LIMIT 1;
  IF v_wallet_id IS NULL THEN
    INSERT INTO wallet (player_id, user_id, sparks, lifetime_sparks)
    VALUES ('u_' || p_user::text, p_user, 0, 0) RETURNING id INTO v_wallet_id;
  END IF;
  UPDATE wallet SET sparks = sparks + p_delta,
    cashable_sparks = cashable_sparks + GREATEST(p_delta, 0),
    lifetime_sparks = lifetime_sparks + GREATEST(p_delta, 0),
    updated_at = now()
  WHERE id = v_wallet_id;
  INSERT INTO spark_ledger (wallet_id, delta, reason, reference) VALUES (v_wallet_id, p_delta, p_reason, p_ref);
END;
$$;
REVOKE EXECUTE ON FUNCTION credit_wallet_for_user FROM anon, authenticated, public;

CREATE OR REPLACE FUNCTION request_withdrawal(sparks_to_redeem integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_sub record; v_wallet record; v_withdrawal_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'You must be signed in to request a withdrawal.'; END IF;
  IF sparks_to_redeem IS NULL OR sparks_to_redeem < 100 THEN RAISE EXCEPTION 'Minimum withdrawal is 100 sparks.'; END IF;

  SELECT status, current_period_end INTO v_sub FROM subscriptions WHERE user_id = v_user ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND OR v_sub.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Only active subscribers can withdraw. Subscribe to unlock cashouts.';
  END IF;
  IF v_sub.current_period_end IS NOT NULL AND v_sub.current_period_end < now() THEN
    RAISE EXCEPTION 'Your subscription has expired. Renew to withdraw.';
  END IF;

  SELECT id, sparks, cashable_sparks INTO v_wallet FROM wallet WHERE user_id = v_user LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No wallet found for your account.'; END IF;
  IF v_wallet.cashable_sparks < sparks_to_redeem THEN
    RAISE EXCEPTION 'Only sparks earned on the Live Map can be cashed out. You have % cash-eligible sparks.', v_wallet.cashable_sparks;
  END IF;

  UPDATE wallet SET sparks = sparks - sparks_to_redeem, cashable_sparks = cashable_sparks - sparks_to_redeem, updated_at = now()
  WHERE id = v_wallet.id;

  INSERT INTO withdrawals (user_id, sparks_used, amount_cents) VALUES (v_user, sparks_to_redeem, sparks_to_redeem)
  RETURNING id INTO v_withdrawal_id;
  INSERT INTO spark_ledger (wallet_id, delta, reason, reference) VALUES (v_wallet.id, -sparks_to_redeem, 'withdrawal', v_withdrawal_id::text);
  RETURN v_withdrawal_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION request_withdrawal FROM anon, public;
GRANT EXECUTE ON FUNCTION request_withdrawal TO authenticated;
