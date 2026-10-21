-- 1) Plot owner rewards are play-only (closes buy-sparks -> plot -> cash loophole)
-- 2) Rush Hour boost: owner pays 150 sparks, plot glows 3h, visitors +5 bonus play sparks, owner earns 6 per visit (play)
-- 3) Sponsored drops: businesses pay Odane; admin places a drop; visitors get a cash-eligible bonus there
CREATE OR REPLACE FUNCTION credit_wallet_play(p_user uuid, p_delta integer, p_reason text, p_ref text, p_player_id text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wallet uuid;
BEGIN
  v_wallet := pick_wallet(p_user, p_player_id);
  UPDATE wallet SET sparks = sparks + p_delta, lifetime_sparks = lifetime_sparks + GREATEST(p_delta, 0), updated_at = now() WHERE id = v_wallet;
  INSERT INTO spark_ledger (wallet_id, delta, reason, reference) VALUES (v_wallet, p_delta, p_reason, p_ref);
END; $$;
REVOKE EXECUTE ON FUNCTION credit_wallet_play FROM anon, authenticated, public;

ALTER TABLE plots ADD COLUMN IF NOT EXISTS boost_until timestamptz;

CREATE TABLE IF NOT EXISTS sponsored_drops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cell_key text NOT NULL, lat_i integer NOT NULL, lng_i integer NOT NULL,
  business_name text NOT NULL, bonus integer NOT NULL DEFAULT 10,
  active_until timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_sponsored_cell ON sponsored_drops(cell_key);
ALTER TABLE sponsored_drops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read active drops" ON sponsored_drops;
CREATE POLICY "read active drops" ON sponsored_drops FOR SELECT TO anon, authenticated USING (active_until > now());

CREATE OR REPLACE FUNCTION boost_plot(p_cell_key text, p_player_id text DEFAULT NULL)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := auth.uid(); v_plot record; v_wallet record; v_until timestamptz;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in first.'; END IF;
  SELECT * INTO v_plot FROM plots WHERE cell_key = p_cell_key FOR UPDATE;
  IF NOT FOUND OR v_plot.owner_id <> v_user THEN RAISE EXCEPTION 'You can only boost your own plot.'; END IF;
  SELECT id, sparks INTO v_wallet FROM wallet WHERE id = pick_wallet(v_user, p_player_id) FOR UPDATE;
  IF v_wallet.sparks < 150 THEN RAISE EXCEPTION 'Rush Hour boost costs 150 sparks.'; END IF;
  UPDATE wallet SET sparks = sparks - 150, updated_at = now() WHERE id = v_wallet.id;
  v_until := GREATEST(COALESCE(v_plot.boost_until, now()), now()) + interval '3 hours';
  UPDATE plots SET boost_until = v_until WHERE cell_key = p_cell_key;
  INSERT INTO spark_ledger (wallet_id, delta, reason, reference) VALUES (v_wallet.id, -150, 'plot_boost', p_cell_key);
  RETURN v_until;
END; $$;
REVOKE EXECUTE ON FUNCTION boost_plot FROM anon, public;
GRANT EXECUTE ON FUNCTION boost_plot TO authenticated;

CREATE OR REPLACE FUNCTION public.check_in(p_lat double precision, p_lng double precision, p_accuracy double precision, p_player_id text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_lat_i integer; v_lng_i integer; v_key text;
  v_last record; v_speed double precision;
  v_today integer; v_plot record; v_owner_today integer;
  v_visitor_reward integer := 5; v_owner_reward integer := 0;
  v_boosted boolean := false; v_boost_bonus integer := 0;
  v_drop record; v_sponsor_bonus integer := 0;
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
    PERFORM credit_wallet_play(v_plot.owner_id, v_owner_reward, 'plot_visit_reward', v_id::text);
    UPDATE plots SET visits = visits + 1, earned = earned + v_owner_reward WHERE cell_key = v_key;
  ELSIF v_plot.owner_id IS NOT NULL AND v_plot.owner_id <> v_user THEN
    UPDATE plots SET visits = visits + 1 WHERE cell_key = v_key;
  END IF;

  RETURN jsonb_build_object('cell_key', v_key, 'visitor_reward', v_visitor_reward, 'owner_reward', v_owner_reward,
    'plot_name', v_plot.name, 'owner_name', v_plot.owner_name, 'boost_bonus', v_boost_bonus,
    'sponsor_bonus', v_sponsor_bonus, 'sponsor_name', v_drop.business_name);
END;
$function$;

CREATE OR REPLACE FUNCTION admin_create_drop(p_name text, p_lat double precision, p_lng double precision, p_bonus integer, p_days integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_la integer := floor(p_lat / 0.0005); v_ln integer := floor(p_lng / 0.0005);
BEGIN
  IF lower(COALESCE(auth.jwt() ->> 'email', '')) <> 'odrich217@gmail.com' THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF p_bonus < 1 OR p_bonus > 50 OR p_days < 1 OR p_days > 365 THEN RAISE EXCEPTION 'Bonus 1-50, days 1-365.'; END IF;
  INSERT INTO sponsored_drops (cell_key, lat_i, lng_i, business_name, bonus, active_until)
  VALUES (v_la || ':' || v_ln, v_la, v_ln, left(btrim(p_name), 40), p_bonus, now() + make_interval(days => p_days)) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
CREATE OR REPLACE FUNCTION admin_end_drop(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF lower(COALESCE(auth.jwt() ->> 'email', '')) <> 'odrich217@gmail.com' THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE sponsored_drops SET active_until = now() WHERE id = p_id;
END; $$;
REVOKE EXECUTE ON FUNCTION admin_create_drop FROM anon, public; GRANT EXECUTE ON FUNCTION admin_create_drop TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_end_drop FROM anon, public; GRANT EXECUTE ON FUNCTION admin_end_drop TO authenticated;
