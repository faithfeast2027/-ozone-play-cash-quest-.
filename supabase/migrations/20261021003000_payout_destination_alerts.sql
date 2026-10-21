ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS payout_method text;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS payout_handle text;

DROP FUNCTION IF EXISTS request_withdrawal(integer);
CREATE OR REPLACE FUNCTION request_withdrawal(sparks_to_redeem integer, p_method text, p_handle text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid(); v_sub record; v_wallet record; v_withdrawal_id uuid;
  v_handle text := btrim(COALESCE(p_handle, ''));
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'You must be signed in to request a withdrawal.'; END IF;
  IF sparks_to_redeem IS NULL OR sparks_to_redeem < 100 THEN RAISE EXCEPTION 'Minimum withdrawal is 100 sparks.'; END IF;
  IF p_method IS NULL OR p_method NOT IN ('cashapp', 'paypal') THEN RAISE EXCEPTION 'Choose Cash App or PayPal for your payout.'; END IF;
  IF length(v_handle) < 3 OR length(v_handle) > 100 THEN RAISE EXCEPTION 'Enter your Cash App $cashtag or PayPal email.'; END IF;

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

  UPDATE wallet SET sparks = sparks - sparks_to_redeem, cashable_sparks = cashable_sparks - sparks_to_redeem, updated_at = now() WHERE id = v_wallet.id;
  INSERT INTO withdrawals (user_id, sparks_used, amount_cents, payout_method, payout_handle)
  VALUES (v_user, sparks_to_redeem, sparks_to_redeem, p_method, v_handle) RETURNING id INTO v_withdrawal_id;
  INSERT INTO spark_ledger (wallet_id, delta, reason, reference) VALUES (v_wallet.id, -sparks_to_redeem, 'withdrawal', v_withdrawal_id::text);
  RETURN v_withdrawal_id;
END; $$;
REVOKE EXECUTE ON FUNCTION request_withdrawal(integer, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION request_withdrawal(integer, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION notify_new_withdrawal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM net.http_post(url := 'https://ntfy.sh/',
    body := jsonb_build_object('topic', 'ozone-signups-1d21c30ec1eb', 'title', 'Payout request!',
      'message', '$' || to_char(NEW.amount_cents / 100.0, 'FM999990.00') || ' via ' || CASE NEW.payout_method WHEN 'cashapp' THEN 'Cash App' ELSE 'PayPal' END || '. Open Payout requests in the app to pay it.',
      'tags', jsonb_build_array('moneybag'), 'priority', 4, 'click', 'https://ozone-cash-quest.netlify.app/'),
    headers := '{"Content-Type":"application/json"}'::jsonb);
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS on_withdrawal_created_notify ON withdrawals;
CREATE TRIGGER on_withdrawal_created_notify AFTER INSERT ON withdrawals FOR EACH ROW EXECUTE FUNCTION notify_new_withdrawal();

CREATE OR REPLACE FUNCTION admin_payouts()
RETURNS TABLE (id uuid, email text, username text, amount_cents integer, sparks_used integer, payout_method text, payout_handle text, status text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF lower(COALESCE(auth.jwt() ->> 'email', '')) <> 'odrich217@gmail.com' THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY SELECT w.id, u.email::text, p.username, w.amount_cents, w.sparks_used, w.payout_method, w.payout_handle, w.status, w.created_at
  FROM withdrawals w JOIN auth.users u ON u.id = w.user_id LEFT JOIN profiles p ON p.id = w.user_id
  ORDER BY (w.status = 'pending') DESC, w.created_at DESC LIMIT 200;
END; $$;
REVOKE EXECUTE ON FUNCTION admin_payouts FROM anon, public;
GRANT EXECUTE ON FUNCTION admin_payouts TO authenticated;

-- paid: marks done. rejected: returns the sparks to the player's cash-eligible balance.
CREATE OR REPLACE FUNCTION admin_set_payout(p_id uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_w record; v_wallet uuid;
BEGIN
  IF lower(COALESCE(auth.jwt() ->> 'email', '')) <> 'odrich217@gmail.com' THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_status NOT IN ('paid', 'rejected') THEN RAISE EXCEPTION 'Bad status'; END IF;
  SELECT * INTO v_w FROM withdrawals WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_w.status <> 'pending' THEN RAISE EXCEPTION 'This request is already handled.'; END IF;
  UPDATE withdrawals SET status = p_status, processed_at = now() WHERE id = p_id;
  IF p_status = 'rejected' THEN
    SELECT id INTO v_wallet FROM wallet WHERE user_id = v_w.user_id LIMIT 1;
    UPDATE wallet SET sparks = sparks + v_w.sparks_used, cashable_sparks = cashable_sparks + v_w.sparks_used, updated_at = now() WHERE id = v_wallet;
    INSERT INTO spark_ledger (wallet_id, delta, reason, reference) VALUES (v_wallet, v_w.sparks_used, 'withdrawal_refund', p_id::text);
  END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION admin_set_payout FROM anon, public;
GRANT EXECUTE ON FUNCTION admin_set_payout TO authenticated;
