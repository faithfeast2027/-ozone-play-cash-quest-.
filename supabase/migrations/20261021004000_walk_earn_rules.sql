-- Walk & Earn: server-computed, members only, 1 spark / 100 steps, 150/day (NY day), walking speed only. Play-only sparks.
CREATE OR REPLACE FUNCTION bank_walk(p_session uuid, p_player_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid(); v_sub record; v_s record; v_secs numeric; v_dist numeric; v_steps integer;
  v_sparks integer; v_today integer; v_wallet uuid; v_day_start timestamptz;
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
  UPDATE walk_sessions SET status = 'completed', ended_at = now(), steps = v_steps, distance_m = floor(v_dist), sparks_earned = v_sparks WHERE id = p_session;
  IF v_sparks > 0 THEN
    v_wallet := pick_wallet(v_user, p_player_id);
    UPDATE wallet SET sparks = sparks + v_sparks, lifetime_sparks = lifetime_sparks + v_sparks, updated_at = now() WHERE id = v_wallet;
    INSERT INTO spark_ledger (wallet_id, delta, reason, reference) VALUES (v_wallet, v_sparks, 'walk_earn', p_session::text);
  END IF;
  RETURN jsonb_build_object('sparks', v_sparks, 'steps', v_steps, 'today', v_today + v_sparks, 'cap', 150);
END; $$;
REVOKE EXECUTE ON FUNCTION bank_walk FROM anon, public;
GRANT EXECUTE ON FUNCTION bank_walk TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_spark_event(p_player_id text, p_reason text, p_delta integer, p_ref text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_wallet record; v_cap integer; v_recent integer; v_last timestamptz;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to save sparks.'; END IF;
  IF p_delta IS NULL OR p_delta = 0 THEN RETURN NULL; END IF;
  SELECT id, sparks INTO v_wallet FROM wallet WHERE id = pick_wallet(v_user, p_player_id) FOR UPDATE;

  IF p_delta < 0 THEN
    IF p_reason NOT IN ('character_purchase') THEN RAISE EXCEPTION 'Unknown spend.'; END IF;
    IF v_wallet.sparks < -p_delta THEN RAISE EXCEPTION 'Not enough sparks.'; END IF;
  ELSE
    v_cap := CASE p_reason
      WHEN 'spark_run_game' THEN 120 WHEN 'mancala_island' THEN 250 WHEN 'nyc_star_crush' THEN 200
      WHEN 'temple_mario_run' THEN 180 WHEN 'floppy_angry_bird' THEN 160 WHEN 'drop_collect' THEN 150
      ELSE 0 END;
    IF v_cap = 0 THEN RAISE EXCEPTION 'Unknown reward.'; END IF;
    p_delta := LEAST(p_delta, v_cap);
    SELECT max(l.created_at) INTO v_last FROM spark_ledger l JOIN wallet w ON w.id = l.wallet_id
      WHERE w.user_id = v_user AND l.reason = p_reason;
    IF v_last IS NOT NULL AND v_last > now() - interval '20 seconds' THEN RAISE EXCEPTION 'Slow down a bit before the next reward.'; END IF;
    SELECT COALESCE(sum(l.delta), 0) INTO v_recent FROM spark_ledger l JOIN wallet w ON w.id = l.wallet_id
      WHERE w.user_id = v_user AND l.delta > 0 AND l.created_at > now() - interval '24 hours'
        AND l.reason IN ('spark_run_game','mancala_island','nyc_star_crush','temple_mario_run','floppy_angry_bird','drop_collect');
    p_delta := LEAST(p_delta, GREATEST(1500 - v_recent, 0));
    IF p_delta <= 0 THEN RAISE EXCEPTION 'Daily game reward limit reached. Come back tomorrow or earn on the Live Map.'; END IF;
  END IF;

  UPDATE wallet SET sparks = sparks + p_delta, lifetime_sparks = lifetime_sparks + GREATEST(p_delta, 0), updated_at = now()
  WHERE id = v_wallet.id;
  INSERT INTO spark_ledger (wallet_id, delta, reason, reference) VALUES (v_wallet.id, p_delta, p_reason, p_ref);
  RETURN p_delta;
END;
$function$
;
