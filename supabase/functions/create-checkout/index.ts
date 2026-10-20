import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "npm:stripe@14.25.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};


async function getSecret(name: string): Promise<string> {
  const env = Deno.env.get(name) ?? "";
  if (env) return env;
  const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data } = await db.from("app_secrets").select("value").eq("name", name).maybeSingle();
  return (data?.value as string) ?? "";
}
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const WALK_EARN_PRICE_ID = Deno.env.get("STRIPE_WALK_EARN_PRICE_ID") ?? "";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Sign in required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const stripe = new Stripe(await getSecret("STRIPE_SECRET_KEY"), { apiVersion: "2023-10-16" });
    const origin = req.headers.get("origin") ?? "https://example.com";

    if (body.mode === "subscription") {
      if (!WALK_EARN_PRICE_ID) {
        return new Response(JSON.stringify({ error: "Walk & Earn plan not configured" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ quantity: 1, price: WALK_EARN_PRICE_ID }],
        success_url: `${origin}/?subscribe=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?subscribe=cancel`,
        metadata: { user_id: user.id, plan: "walk_earn_monthly" },
      });
      await supabase.from("subscriptions").upsert({
        user_id: user.id,
        status: "trialing",
        plan: "walk_earn_monthly",
        stripe_customer_id: null,
        stripe_subscription_id: null,
      }, { onConflict: "user_id" });
      return new Response(JSON.stringify({ url: session.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.mode === "billing_portal") {
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("stripe_customer_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!sub?.stripe_customer_id) {
        return new Response(JSON.stringify({ error: "No subscription found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const portal = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id,
        return_url: `${origin}/`,
      });
      return new Response(JSON.stringify({ url: portal.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { productId, playerId } = body;
    if (!productId || !playerId) {
      return new Response(JSON.stringify({ error: "Missing productId or playerId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: product, error } = await supabase
      .from("products")
      .select("id, name, sparks, price_cents, tagline")
      .eq("id", productId)
      .maybeSingle();

    if (error || !product) {
      return new Response(JSON.stringify({ error: "Product not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: product.price_cents,
            product_data: {
              name: product.name,
              description: product.tagline ?? undefined,
            },
          },
        },
      ],
      success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=cancel`,
      metadata: {
        product_id: product.id,
        player_id: playerId,
        user_id: user.id,
        sparks: String(product.sparks),
      },
    });

    await supabase.from("orders").insert({
      stripe_checkout_session_id: session.id,
      product_id: product.id,
      sparks: product.sparks,
      amount_cents: product.price_cents,
      status: "pending",
      user_id: user.id,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
// force redeploy
