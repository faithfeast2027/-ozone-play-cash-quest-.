/*
# Server-side spark rewards (no more client-written balances)
- Drops the client UPDATE policy on wallet: browsers can no longer set sparks.
- New wallets inserted by the client always start at 0.
- apply_spark_event(p_player_id, p_reason, p_delta, p_ref): the only way the app
  changes a balance. Spends need enough balance; rewards are capped per play,
  rate-limited per game (20 s), and capped at 1500 game sparks per 24 h.
- Wallet choice: the caller's wallet with that player_id; otherwise their most
  recently updated wallet. check_in / buy_plot accept p_player_id the same way.
*/
DROP POLICY IF EXISTS "authenticated_update_own_wallet" ON wallet;

CREATE OR REPLACE FUNCTION guard_wallet_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    NEW.sparks := 0; NEW.lifetime_sparks := 0; NEW.cashable_sparks := 0;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_wallet_insert ON wallet;
CREATE TRIGGER trg_guard_wallet_insert BEFORE INSERT ON wallet FOR EACH ROW EXECUTE FUNCTION guard_wallet_insert();

CREATE OR REPLACE FUNCTION pick_wallet(p_user uuid, p_player_id text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  IF p_player_id IS NOT NULL THEN
    SELECT id INTO v FROM wallet WHERE user_id = p_user AND player_id = p_player_id;
  END IF;
  IF v IS NULL THEN
    SELECT id INTO v FROM wallet WHERE user_id = p_user ORDER BY updated_at DESC LIMIT 1;
  END IF;
  IF v IS NULL THEN
    INSERT INTO wallet (player_id, user_id, sparks, lifetime_sparks)
    VALUES (COALESCE(p_player_id, 'u_' || p_user::text), p_user, 0, 0) RETURNING id INTO v;
  END IF;
  RETURN v;
END;
$$;
REVOKE EXECUTE ON FUNCTION pick_wallet FROM anon, authenticated, public;

CREATE OR REPLACE FUNCTION credit_wallet_for_user(p_user uuid, p_delta integer, p_reason text, p_ref text, p_player_id text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wallet_id uuid := pick_wallet(p_user, p_player_id);
BEGIN
  UPDATE wallet SET sparks = sparks + p_delta,
    cashable_sparks = cashable_sparks + GREATEST(p_delta, 0),
    lifetime_sparks = lifetime_sparks + GREATEST(p_delta, 0), updated_at = now()
  WHERE id = v_wallet_id;
  INSERT INTO spark_ledger (wallet_id, delta, reason, reference) VALUES (v_wallet_id, p_delta, p_reason, p_ref);
END;
$$;
DROP FUNCTION IF EXISTS credit_wallet_for_user(uuid, integer, text, text);
REVOKE EXECUTE ON FUNCTION credit_wallet_for_user FROM anon, authenticated, public;

CREATE OR REPLACE FUNCTION apply_spark_event(p_player_id text, p_reason text, p_delta integer, p_ref text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
      WHEN 'walk_earn' THEN 500 ELSE 0 END;
    IF v_cap = 0 THEN RAISE EXCEPTION 'Unknown reward.'; END IF;
    p_delta := LEAST(p_delta, v_cap);
    SELECT max(l.created_at) INTO v_last FROM spark_ledger l JOIN wallet w ON w.id = l.wallet_id
      WHERE w.user_id = v_user AND l.reason = p_reason;
    IF v_last IS NOT NULL AND v_last > now() - interval '20 seconds' THEN RAISE EXCEPTION 'Slow down a bit before the next reward.'; END IF;
    SELECT COALESCE(sum(l.delta), 0) INTO v_recent FROM spark_ledger l JOIN wallet w ON w.id = l.wallet_id
      WHERE w.user_id = v_user AND l.delta > 0 AND l.created_at > now() - interval '24 hours'
        AND l.reason IN ('spark_run_game','mancala_island','nyc_star_crush','temple_mario_run','floppy_angry_bird','drop_collect','walk_earn');
    p_delta := LEAST(p_delta, GREATEST(1500 - v_recent, 0));
    IF p_delta <= 0 THEN RAISE EXCEPTION 'Daily game reward limit reached. Come back tomorrow or earn on the Live Map.'; END IF;
  END IF;

  UPDATE wallet SET sparks = sparks + p_delta, lifetime_sparks = lifetime_sparks + GREATEST(p_delta, 0), updated_at = now()
  WHERE id = v_wallet.id;
  INSERT INTO spark_ledger (wallet_id, delta, reason, reference) VALUES (v_wallet.id, p_delta, p_reason, p_ref);
  RETURN p_delta;
END;
$$;
REVOKE EXECUTE ON FUNCTION apply_spark_event FROM anon, public;
GRANT EXECUTE ON FUNCTION apply_spark_event TO authenticated;

-- check_in / buy_plot: target the wallet the player is using
DROP FUNCTION IF EXISTS check_in(double precision, double precision, double precision);
DROP FUNCTION IF EXISTS buy_plot(integer, integer, text);
CREATE OR REPLACE FUNCTION check_in(p_lat double precision, p_lng double precision, p_accuracy double precision, p_player_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_lat_i integer; v_lng_i integer; v_key text;
  v_last record; v_speed double precision;
  v_today integer; v_plot record; v_owner_today integer;
  v_visitor_reward integer := 5; v_owner_reward integer := 0;
  v_id uuid;
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
    SELECT COALESCE(sum(owner_reward), 0) INTO v_owner_today FROM check_ins WHERE owner_id = v_plot.owner_id AND created_at > now() - interval '24 hours';
    IF v_owner_today < 300 THEN v_owner_reward := 2; END IF;
    v_visitor_reward := 8; -- bonus for visiting someone's plot
  END IF;

  INSERT INTO check_ins (user_id, cell_key, lat, lng, accuracy_m, visitor_reward, owner_id, owner_reward)
  VALUES (v_user, v_key, p_lat, p_lng, p_accuracy, v_visitor_reward, CASE WHEN v_plot.owner_id IS NOT NULL AND v_plot.owner_id <> v_user THEN v_plot.owner_id END, v_owner_reward)
  RETURNING id INTO v_id;

  PERFORM credit_wallet_for_user(v_user, v_visitor_reward, 'map_check_in', v_id::text, p_player_id);
  IF v_owner_reward > 0 THEN
    PERFORM credit_wallet_for_user(v_plot.owner_id, v_owner_reward, 'plot_visit_reward', v_id::text);
    UPDATE plots SET visits = visits + 1, earned = earned + v_owner_reward WHERE cell_key = v_key;
  ELSIF v_plot.owner_id IS NOT NULL AND v_plot.owner_id <> v_user THEN
    UPDATE plots SET visits = visits + 1 WHERE cell_key = v_key;
  END IF;

  RETURN jsonb_build_object('cell_key', v_key, 'visitor_reward', v_visitor_reward, 'owner_reward', v_owner_reward,
    'plot_name', v_plot.name, 'owner_name', v_plot.owner_name);
END;
$$;
REVOKE EXECUTE ON FUNCTION check_in FROM anon, public;
GRANT EXECUTE ON FUNCTION check_in TO authenticated;

CREATE OR REPLACE FUNCTION buy_plot(p_lat_i integer, p_lng_i integer, p_name text, p_player_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_price integer := 500;
  v_key text := p_lat_i || ':' || p_lng_i;
  v_wallet record; v_count integer; v_owner_name text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to buy plots.'; END IF;
  IF abs(p_lat_i) > 170000 OR abs(p_lng_i) > 360000 THEN RAISE EXCEPTION 'Invalid plot.'; END IF;
  IF EXISTS (SELECT 1 FROM plots WHERE cell_key = v_key) THEN RAISE EXCEPTION 'This plot is already owned.'; END IF;
  SELECT count(*) INTO v_count FROM plots WHERE owner_id = v_user;
  IF v_count >= 25 THEN RAISE EXCEPTION 'You own the max of 25 plots.'; END IF;

  SELECT id, sparks INTO v_wallet FROM wallet WHERE id = pick_wallet(v_user, p_player_id) FOR UPDATE;
  IF NOT FOUND OR v_wallet.sparks < v_price THEN RAISE EXCEPTION 'You need 500 sparks to buy a plot.'; END IF;

  SELECT COALESCE(raw_user_meta_data->>'display_name', split_part(email, '@', 1)) INTO v_owner_name FROM auth.users WHERE id = v_user;

  INSERT INTO plots (cell_key, lat_i, lng_i, owner_id, owner_name, name, price_paid)
  VALUES (v_key, p_lat_i, p_lng_i, v_user, v_owner_name, left(COALESCE(NULLIF(trim(p_name), ''), 'My plot'), 40), v_price);

  UPDATE wallet SET sparks = sparks - v_price, updated_at = now() WHERE id = v_wallet.id;
  INSERT INTO spark_ledger (wallet_id, delta, reason, reference) VALUES (v_wallet.id, -v_price, 'buy_plot', v_key);

  RETURN jsonb_build_object('cell_key', v_key, 'price', v_price);
END;
$$;
REVOKE EXECUTE ON FUNCTION buy_plot FROM anon, public;
GRANT EXECUTE ON FUNCTION buy_plot TO authenticated;
