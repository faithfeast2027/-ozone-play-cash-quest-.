CREATE OR REPLACE FUNCTION public.bank_walk(p_session uuid, p_player_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid(); v_sub record; v_s record; v_secs numeric; v_dist numeric; v_steps integer;
  v_sparks integer; v_today integer; v_cash integer; v_month integer; v_wallet uuid; v_day_start timestamptz;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in first.'; END IF;
  SELECT status, current_period_end INTO v_sub FROM subscriptions WHERE user_id = v_user ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND OR v_sub.status IS DISTINCT FROM 'active' OR (v_sub.current_period_end IS NOT NULL AND v_sub.current_period_end < now()) THEN
    RAISE EXCEPTION 'Walk & Earn is for active members.';
  END IF;
  SELECT * INTO v_s FROM walk_sessions WHERE id = p_session AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Walk not found.'; END IF;
  IF v_s.status = 'completed' THEN RAISE EXCEPTION 'This walk was already banked.'; END IF;
  v_secs := GREATEST(EXTRACT(EPOCH FROM now() - v_s.started_at), 0);
  v_dist := LEAST(COALESCE(v_s.distance_m, 0), v_secs * 3.4);  -- ~12 km/h max average
  v_steps := floor(v_dist * 1.35);
  v_sparks := floor(v_steps / 100.0);
  v_day_start := date_trunc('day', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York';
  SELECT COALESCE(sum(l.delta), 0) INTO v_today FROM spark_ledger l JOIN wallet w ON w.id = l.wallet_id
    WHERE w.user_id = v_user AND l.reason = 'walk_earn' AND l.delta > 0 AND l.created_at >= v_day_start;
  v_sparks := GREATEST(LEAST(v_sparks, 150 - v_today), 0);
  SELECT COALESCE(sum(cashable_sparks), 0) INTO v_month FROM walk_sessions
    WHERE user_id = v_user AND ended_at >= date_trunc('month', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York';
  v_cash := GREATEST(LEAST(v_sparks, 600 - v_month), 0);  -- up to 600 cashable walk sparks ($6) per month
  UPDATE walk_sessions SET status = 'completed', ended_at = now(), steps = v_steps, distance_m = floor(v_dist), sparks_earned = v_sparks, cashable_sparks = v_cash WHERE id = p_session;
  IF v_sparks > 0 THEN
    v_wallet := pick_wallet(v_user, p_player_id);
    UPDATE wallet SET sparks = sparks + v_sparks, cashable_sparks = cashable_sparks + v_cash, lifetime_sparks = lifetime_sparks + v_sparks, updated_at = now() WHERE id = v_wallet;
    INSERT INTO spark_ledger (wallet_id, delta, reason, reference) VALUES (v_wallet, v_sparks, 'walk_earn', p_session::text);
  END IF;
  RETURN jsonb_build_object('sparks', v_sparks, 'steps', v_steps, 'today', v_today + v_sparks, 'cap', 150, 'cashable', v_cash, 'month_cashable', v_month + v_cash, 'month_cap', 600);
END; $function$
;
