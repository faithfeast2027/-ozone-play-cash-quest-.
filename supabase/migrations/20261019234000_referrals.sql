/*
# Invite friends / referrals
- Share link: https://ozone-cash-quest.netlify.app/?ref=<inviter user id>
- accept_referral(p_ref): called once after the new player signs in.
  Makes both players friends. If the new account is less than 48 h old and has
  never been referred, records the referral and gives play-only sparks
  (inviter +100, new player +50). Inviter rewards capped at 25 referrals.
  These sparks are NOT cash-eligible.
*/
CREATE TABLE IF NOT EXISTS referrals (
  referred_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  referrer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rewarded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (referred_id <> referrer_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS referrals_select_involved ON referrals;
CREATE POLICY referrals_select_involved ON referrals FOR SELECT TO authenticated
  USING (referrer_id = auth.uid() OR referred_id = auth.uid());

CREATE OR REPLACE FUNCTION play_credit(p_user uuid, p_delta integer, p_reason text, p_ref text, p_player_id text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid := pick_wallet(p_user, p_player_id);
BEGIN
  UPDATE wallet SET sparks = sparks + p_delta, lifetime_sparks = lifetime_sparks + GREATEST(p_delta,0), updated_at = now() WHERE id = v;
  INSERT INTO spark_ledger (wallet_id, delta, reason, reference) VALUES (v, p_delta, p_reason, p_ref);
END;
$$;
REVOKE EXECUTE ON FUNCTION play_credit FROM anon, authenticated, public;

CREATE OR REPLACE FUNCTION accept_referral(p_ref uuid, p_player_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_created timestamptz;
  v_count integer;
  v_reward boolean := false;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in first.'; END IF;
  IF p_ref IS NULL OR p_ref = v_user OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_ref) THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  INSERT INTO friendships (user_id, friend_id) VALUES (v_user, p_ref), (p_ref, v_user) ON CONFLICT DO NOTHING;

  SELECT created_at INTO v_created FROM auth.users WHERE id = v_user;
  IF v_created > now() - interval '48 hours' AND NOT EXISTS (SELECT 1 FROM referrals WHERE referred_id = v_user) THEN
    SELECT count(*) INTO v_count FROM referrals WHERE referrer_id = p_ref AND rewarded;
    v_reward := v_count < 25;
    INSERT INTO referrals (referred_id, referrer_id, rewarded) VALUES (v_user, p_ref, v_reward);
    IF v_reward THEN
      PERFORM play_credit(p_ref, 100, 'referral_inviter', v_user::text);
      PERFORM play_credit(v_user, 50, 'referral_welcome', p_ref::text, p_player_id);
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'rewarded', v_reward);
END;
$$;
REVOKE EXECUTE ON FUNCTION accept_referral FROM anon, public;
GRANT EXECUTE ON FUNCTION accept_referral TO authenticated;

CREATE OR REPLACE FUNCTION my_referral_count() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT count(*)::int FROM referrals WHERE referrer_id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION my_referral_count TO authenticated;
