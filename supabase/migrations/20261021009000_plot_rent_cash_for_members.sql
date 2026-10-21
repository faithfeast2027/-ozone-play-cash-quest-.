-- Monopoly back: plot rent cash-eligible for members, sharing the plan's monthly cash limit with walking; rest play sparks
CREATE OR REPLACE FUNCTION member_cash_room(p_user uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sub record; v_cap integer; v_used integer; v_start timestamptz;
BEGIN
  SELECT status, current_period_end, plan INTO v_sub FROM subscriptions WHERE user_id = p_user ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND OR v_sub.status IS DISTINCT FROM 'active' OR (v_sub.current_period_end IS NOT NULL AND v_sub.current_period_end < now()) THEN RETURN 0; END IF;
  v_cap := CASE v_sub.plan WHEN 'marathon' THEN 2000 WHEN 'stride' THEN 1200 ELSE 600 END;
  v_start := date_trunc('month', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York';
  SELECT COALESCE(sum(cashable_sparks), 0) INTO v_used FROM walk_sessions WHERE user_id = p_user AND ended_at >= v_start;
  v_used := v_used + COALESCE((SELECT sum(l.delta) FROM spark_ledger l JOIN wallet w ON w.id = l.wallet_id
    WHERE w.user_id = p_user AND l.reason = 'plot_rent_cash' AND l.created_at >= v_start), 0);
  RETURN GREATEST(v_cap - v_used, 0);
END; $$;
REVOKE EXECUTE ON FUNCTION member_cash_room FROM anon, authenticated, public;

CREATE OR REPLACE FUNCTION public.check_in(p_lat double precision, p_lng double precision, p_accuracy double precision, p_player_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_lat_i integer; v_lng_i integer; v_key text;
  v_last record; v_speed double precision;
  v_today integer; v_plot record; v_owner_today integer;
  v_visitor_reward integer := 5; v_owner_reward integer := 0;
  v_boosted boolean := false; v_boost_bonus integer := 0;
  v_drop record; v_sponsor_bonus integer := 0;
  v_id uuid; v_rent_cash integer := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to check in.'; END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR abs(p_lat) > 85 OR abs(p_lng) > 180 THEN RAISE EXCEPTION 'Invalid location.'; END IF;
  IF p_accuracy IS NULL OR p_accuracy > 80 THEN RAISE EXCEPTION 'GPS signal too weak. Step outside and try again.'; END IF;

  v_lat_i := floor(p_lat / 0.0005); v_lng_i := floor(p_lng / 0.0005);
  v_key := v_lat_i || ':' || v_lng_i;

  IF EXISTS (SELECT 1 FROM check_ins WHERE user_id = v_user AND cell_key = v_key AND created_at > now() - interval '6 hours') THEN
    RAISE EXCEPTION 'You already checked in here. Come back in a few hours.';
  END IF;

  SELECT lat, lng, created_at INTO v_last FROM check_ins WHERE user_id = v_user ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    v_speed := geo_distance_m(v_last.lat, v_last.lng, p_lat, p_lng) / GREATEST(extract(epoch FROM now() - v_last.created_at), 1);
    IF v_speed > 55 THEN RAISE EXCEPTION 'Movement looks too fast. Check-in blocked.'; END IF;
  END IF;

  SELECT count(*) INTO v_today FROM check_ins WHERE user_id = v_user AND created_at > now() - interval '24 hours';
  IF v_today >= 30 THEN RAISE EXCEPTION 'Daily check-in limit reached.'; END IF;

  SELECT * INTO v_plot FROM plots WHERE cell_key = v_key FOR UPDATE;
  IF FOUND AND v_plot.owner_id <> v_user THEN
    v_boosted := v_plot.boost_until IS NOT NULL AND v_plot.boost_until > now();
    SELECT COALESCE(sum(owner_reward), 0) INTO v_owner_today FROM check_ins WHERE owner_id = v_plot.owner_id AND created_at > now() - interval '24 hours';
    IF v_owner_today < 300 THEN v_owner_reward := CASE WHEN v_boosted THEN 6 ELSE 2 END; END IF;
    v_visitor_reward := 8;
    IF v_boosted THEN v_boost_bonus := 5; END IF;
  END IF;

  SELECT * INTO v_drop FROM sponsored_drops WHERE cell_key = v_key AND active_until > now() ORDER BY bonus DESC LIMIT 1;
  IF FOUND THEN v_sponsor_bonus := v_drop.bonus; END IF;

  INSERT INTO check_ins (user_id, cell_key, lat, lng, accuracy_m, visitor_reward, owner_id, owner_reward)
  VALUES (v_user, v_key, p_lat, p_lng, p_accuracy, v_visitor_reward + v_boost_bonus + v_sponsor_bonus, CASE WHEN v_plot.owner_id IS NOT NULL AND v_plot.owner_id <> v_user THEN v_plot.owner_id END, v_owner_reward)
  RETURNING id INTO v_id;

  PERFORM credit_wallet_for_user(v_user, v_visitor_reward + v_sponsor_bonus, 'map_check_in', v_id::text, p_player_id);
  IF v_boost_bonus > 0 THEN PERFORM credit_wallet_play(v_user, v_boost_bonus, 'boost_bonus', v_id::text, p_player_id); END IF;
  IF v_owner_reward > 0 THEN
    v_rent_cash := LEAST(v_owner_reward, member_cash_room(v_plot.owner_id));
    IF v_rent_cash > 0 THEN PERFORM credit_wallet_for_user(v_plot.owner_id, v_rent_cash, 'plot_rent_cash', v_id::text); END IF;
    IF v_owner_reward > v_rent_cash THEN PERFORM credit_wallet_play(v_plot.owner_id, v_owner_reward - v_rent_cash, 'plot_visit_reward', v_id::text); END IF;
    UPDATE plots SET visits = visits + 1, earned = earned + v_owner_reward WHERE cell_key = v_key;
  ELSIF v_plot.owner_id IS NOT NULL AND v_plot.owner_id <> v_user THEN
    UPDATE plots SET visits = visits + 1 WHERE cell_key = v_key;
  END IF;

  RETURN jsonb_build_object('cell_key', v_key, 'visitor_reward', v_visitor_reward, 'owner_reward', v_owner_reward,
    'plot_name', v_plot.name, 'owner_name', v_plot.owner_name, 'boost_bonus', v_boost_bonus,
    'sponsor_bonus', v_sponsor_bonus, 'sponsor_name', v_drop.business_name);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.bank_walk(p_session uuid, p_player_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid(); v_sub record; v_s record; v_secs numeric; v_dist numeric; v_steps integer;
  v_sparks integer; v_today integer; v_cash integer; v_month integer; v_daycap integer; v_monthcap integer; v_wallet uuid; v_day_start timestamptz;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in first.'; END IF;
  SELECT status, current_period_end, plan INTO v_sub FROM subscriptions WHERE user_id = v_user ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND OR v_sub.status IS DISTINCT FROM 'active' OR (v_sub.current_period_end IS NOT NULL AND v_sub.current_period_end < now()) THEN
    RAISE EXCEPTION 'Walk & Earn is for active members.';
  END IF;
  v_daycap := CASE v_sub.plan WHEN 'marathon' THEN 400 WHEN 'stride' THEN 250 ELSE 150 END;
  v_monthcap := CASE v_sub.plan WHEN 'marathon' THEN 2000 WHEN 'stride' THEN 1200 ELSE 600 END;
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
  v_sparks := GREATEST(LEAST(v_sparks, v_daycap - v_today), 0);
  SELECT COALESCE(sum(cashable_sparks), 0) INTO v_month FROM walk_sessions
    WHERE user_id = v_user AND ended_at >= date_trunc('month', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York';
  v_cash := GREATEST(LEAST(v_sparks, member_cash_room(v_user)), 0);  -- walking + plot rent share the plan's monthly cash limit  -- up to 600 cashable walk sparks ($6) per month
  UPDATE walk_sessions SET status = 'completed', ended_at = now(), steps = v_steps, distance_m = floor(v_dist), sparks_earned = v_sparks, cashable_sparks = v_cash WHERE id = p_session;
  IF v_sparks > 0 THEN
    v_wallet := pick_wallet(v_user, p_player_id);
    UPDATE wallet SET sparks = sparks + v_sparks, cashable_sparks = cashable_sparks + v_cash, lifetime_sparks = lifetime_sparks + v_sparks, updated_at = now() WHERE id = v_wallet;
    INSERT INTO spark_ledger (wallet_id, delta, reason, reference) VALUES (v_wallet, v_sparks, 'walk_earn', p_session::text);
  END IF;
  RETURN jsonb_build_object('sparks', v_sparks, 'steps', v_steps, 'today', v_today + v_sparks, 'cap', v_daycap, 'cashable', v_cash, 'month_cashable', v_month + v_cash, 'month_cap', v_monthcap, 'tier', COALESCE(v_sub.plan, 'walk'));
END; $function$
;
