/*
# Make stripe_price_id optional and seed spark packages

## Overview
Switches to inline Stripe Checkout pricing (price_data) so we don't need
pre-created Stripe Price objects. Makes products.stripe_price_id nullable, then
seeds four spark packages.

## Changes
1. products.stripe_price_id: drop NOT NULL constraint (keep UNIQUE).
2. Seed four products: Starter, Boost, Vault, Overdrive.

## Security
No policy changes.
*/

ALTER TABLE products ALTER COLUMN stripe_price_id DROP NOT NULL;

INSERT INTO products (name, sparks, price_cents, tagline, sort_order)
VALUES
  ('Spark Starter', 1000, 99, 'Dip in. 1,000 sparks to prime the field.', 1),
  ('Spark Boost', 3000, 249, 'Triple the fuel. Best for daily grinders.', 2),
  ('Spark Vault', 7500, 499, 'Big reserve. Bonus 500 sparks built in.', 3),
  ('Overdrive', 16000, 999, 'Max capacity. Best value per dollar.', 4)
ON CONFLICT DO NOTHING;
