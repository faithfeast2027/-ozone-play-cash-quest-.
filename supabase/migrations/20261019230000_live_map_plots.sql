/*
# Live Map: plots, check-ins, owner rewards

The world is split into a grid of cells about 55 m tall (0.0005 deg lat by
0.0005 deg lng). A cell key is "<lat_i>:<lng_i>" where lat_i = floor(lat/0.0005).

## Tables
- plots: one row per owned cell. Public read. Writes only through buy_plot().
- check_ins: one row per accepted visit. Owner-readable. Writes only through check_in().

## Functions (SECURITY DEFINER, auth required)
- check_in(p_lat, p_lng, p_accuracy): validates GPS accuracy, per-cell cooldown,
  impossible travel speed and a daily cap, then credits the visitor and the plot
  owner (if any, and not the visitor) with sparks.
- buy_plot(p_lat_i, p_lng_i, p_name): buys an unowned cell for sparks.

## Anti-abuse
- Accuracy must be <= 80 m.
- Same user + same cell: once every 6 hours.
- Travel faster than 55 m/s (~200 km/h) since the last check-in is rejected.
- 30 check-ins per user per day; owners earn at most 300 sparks per day from visits.
- Max 25 plots per user.
*/

CREATE TABLE IF NOT EXISTS plots (
  cell_key text PRIMARY KEY,
  lat_i integer NOT NULL,
  lng_i integer NOT NULL,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_name text,
  name text,
  price_paid integer NOT NULL DEFAULT 0,
  visits integer NOT NULL DEFAULT 0,
  earned integer NOT NULL DEFAULT 0,
  purchased_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plots_lat_lng ON plots(lat_i, lng_i);
CREATE INDEX IF NOT EXISTS idx_plots_owner ON plots(owner_id);
ALTER TABLE plots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plots_public_read" ON plots;
CREATE POLICY "plots_public_read" ON plots FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS check_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cell_key text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy_m double precision,
  visitor_reward integer NOT NULL DEFAULT 0,
  owner_id uuid,
  owner_reward integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_check_ins_user_time ON check_ins(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_check_ins_owner_time ON check_ins(owner_id, created_at DESC);
ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "check_ins_own_read" ON check_ins;
CREATE POLICY "check_ins_own_read" ON check_ins FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR auth.uid() = owner_id);

CREATE OR REPLACE FUNCTION geo_distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

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
    lifetime_sparks = lifetime_sparks + GREATEST(p_delta, 0),
    updated_at = now()
  WHERE id = v_wallet_id;
  INSERT INTO spark_ledger (wallet_id, delta, reason, reference) VALUES (v_wallet_id, p_delta, p_reason, p_ref);
END;
$$;
REVOKE EXECUTE ON FUNCTION credit_wallet_for_user FROM anon, authenticated, public;

CREATE OR REPLACE FUNCTION check_in(p_lat double precision, p_lng double precision, p_accuracy double precision)
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

  PERFORM credit_wallet_for_user(v_user, v_visitor_reward, 'map_check_in', v_id::text);
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

CREATE OR REPLACE FUNCTION buy_plot(p_lat_i integer, p_lng_i integer, p_name text)
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

  SELECT id, sparks INTO v_wallet FROM wallet WHERE user_id = v_user LIMIT 1 FOR UPDATE;
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
