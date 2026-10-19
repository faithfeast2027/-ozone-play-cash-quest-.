/*
# Secure wallet ownership for signed-in players

## Overview
Adds account ownership to wallets and purchase orders now that Ozone Play has
email sign-in. Existing rows are preserved; new rows automatically receive the
signed-in account ID from the database session.

## Modified Tables

### wallet
- Adds `user_id` (uuid, references auth.users) with a default of auth.uid().
- Existing anonymous rows remain intact but are no longer exposed to signed-in
  users unless they are associated with that account.

### orders
- Adds `user_id` (uuid, references auth.users) with a default of auth.uid().
- Checkout functions insert the verified account ID.

## Security Changes
- Wallet SELECT/INSERT/UPDATE are restricted to the authenticated owner.
- Spark ledger SELECT is restricted through the owning wallet.
- Client-side ledger inserts and wallet writes are removed from the data API;
  payment credits remain server-side through the Stripe webhook.
- Product catalog remains readable to everyone.

## Important Notes
1. No columns or rows are deleted.
2. The account ID is derived from auth.uid(), never trusted from the browser.
3. Existing anonymous wallets are retained for data safety but are not treated as
   owned by a new account.
*/

ALTER TABLE wallet ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE wallet ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE orders ALTER COLUMN user_id SET DEFAULT auth.uid();

DROP POLICY IF EXISTS "anon_select_wallet" ON wallet;
DROP POLICY IF EXISTS "anon_insert_wallet" ON wallet;
DROP POLICY IF EXISTS "anon_update_wallet" ON wallet;
DROP POLICY IF EXISTS "anon_read_orders" ON orders;
DROP POLICY IF EXISTS "anon_insert_orders" ON orders;
DROP POLICY IF EXISTS "anon_select_ledger" ON spark_ledger;
DROP POLICY IF EXISTS "anon_insert_ledger" ON spark_ledger;

CREATE POLICY "authenticated_select_own_wallet" ON wallet FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "authenticated_insert_own_wallet" ON wallet FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "authenticated_update_own_wallet" ON wallet FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "authenticated_select_own_orders" ON orders FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "authenticated_select_own_ledger" ON spark_ledger FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM wallet
      WHERE wallet.id = spark_ledger.wallet_id
        AND wallet.user_id = auth.uid()
    )
  );
