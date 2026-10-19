/*
# Reset demo wallet balances for fresh starts

## Overview
Resets the stored Ozone Play wallet balances so every existing dashboard starts
from a clean slate, matching the new-account experience.

## Modified Table

### wallet
- Sets `sparks` to 0 for every existing wallet.
- Sets `lifetime_sparks` to 0 for every existing wallet.
- Refreshes `updated_at` for each reset row.

## Security Changes
No RLS policies are changed. Existing account ownership rules remain active.

## Important Notes
1. This is an intentional product reset requested for the fresh dashboard launch.
2. Ledger history is retained and not deleted.
3. Future wallets already default to zero through the application flow.
*/

UPDATE wallet
SET sparks = 0,
    lifetime_sparks = 0,
    updated_at = now();
