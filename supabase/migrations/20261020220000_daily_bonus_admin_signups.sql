CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS daily_bonus_claims (
  user_id uuid NOT NULL, day date NOT NULL, amount integer NOT NULL, streak integer NOT NULL,
  created_at timestamptz DEFAULT now(), PRIMARY KEY (user_id, day));
ALTER TABLE daily_bonus_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own bonus claims" ON daily_bonus_claims;
CREATE POLICY "own bonus claims" ON daily_bonus_claims FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION claim_daily_bonus(p_player_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := auth.uid(); v_day date := (now() AT TIME ZONE 'America/New_York')::date;
  v_prev integer; v_streak integer; v_amount integer; v_wallet uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in first.'; END IF;
  IF EXISTS (SELECT 1 FROM daily_bonus_claims WHERE user_id = v_user AND day = v_day) THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;
  SELECT streak INTO v_prev FROM daily_bonus_claims WHERE user_id = v_user AND day = v_day - 1;
  v_streak := COALESCE(v_prev, 0) + 1;
  v_amount := LEAST(20 + (v_streak - 1) * 5, 50);
  INSERT INTO daily_bonus_claims (user_id, day, amount, streak) VALUES (v_user, v_day, v_amount, v_streak);
  v_wallet := pick_wallet(v_user, p_player_id);
  UPDATE wallet SET sparks = sparks + v_amount, lifetime_sparks = lifetime_sparks + v_amount, updated_at = now() WHERE id = v_wallet;
  INSERT INTO spark_ledger (wallet_id, delta, reason, reference) VALUES (v_wallet, v_amount, 'daily_bonus', v_day::text);
  RETURN jsonb_build_object('claimed', true, 'amount', v_amount, 'streak', v_streak);
END; $$;
REVOKE EXECUTE ON FUNCTION claim_daily_bonus FROM anon, public;
GRANT EXECUTE ON FUNCTION claim_daily_bonus TO authenticated;

CREATE OR REPLACE FUNCTION admin_signups()
RETURNS TABLE (email text, joined timestamptz, username text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF lower(COALESCE(auth.jwt() ->> 'email', '')) <> 'odrich217@gmail.com' THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY SELECT u.email::text, u.created_at, p.username FROM auth.users u LEFT JOIN profiles p ON p.id = u.id ORDER BY u.created_at DESC LIMIT 300;
END; $$;
REVOKE EXECUTE ON FUNCTION admin_signups FROM anon, public;
GRANT EXECUTE ON FUNCTION admin_signups TO authenticated;

CREATE OR REPLACE FUNCTION notify_new_signup() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total integer; v_mask text;
BEGIN
  SELECT count(*) INTO v_total FROM auth.users;
  v_mask := left(split_part(NEW.email, '@', 1), 2) || '***@' || split_part(NEW.email, '@', 2);
  PERFORM net.http_post(url := 'https://ntfy.sh/',
    body := jsonb_build_object('topic', 'ozone-signups-1d21c30ec1eb', 'title', 'New Ozone player!', 'message', v_mask || ' just signed up. Total players: ' || v_total, 'tags', jsonb_build_array('tada'), 'click', 'https://ozone-cash-quest.netlify.app/'),
    headers := '{"Content-Type":"application/json"}'::jsonb);
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS on_auth_user_created_notify ON auth.users;
CREATE TRIGGER on_auth_user_created_notify AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION notify_new_signup();
