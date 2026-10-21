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

async function syncSubscription(stripe: Stripe, supabase: ReturnType<typeof createClient>, subscriptionId: string, fallbackUserId?: string) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  let userId = subscription.metadata?.user_id || fallbackUserId;
  if (!userId) {
    const { data } = await supabase.from("subscriptions").select("user_id").eq("stripe_subscription_id", subscription.id).maybeSingle();
    userId = data?.user_id as string | undefined;
  }
  if (!userId) return;
  const amount = subscription.items.data[0]?.price?.unit_amount ?? 0;
  const tier = amount >= 2499 ? "marathon" : amount >= 1499 ? "stride" : "walk";
  const status = subscription.status === "active" || subscription.status === "trialing" ? "active" : subscription.status;
  await supabase.from("subscriptions").upsert({
    user_id: userId,
    stripe_subscription_id: subscription.id,
    stripe_customer_id: subscription.customer as string,
    status,
    plan: tier,
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const stripe = new Stripe(await getSecret("STRIPE_SECRET_KEY"), { apiVersion: "2023-10-16" });
    const signature = req.headers.get("stripe-signature") ?? "";
    const body = await req.text();
    const event = await stripe.webhooks.constructEventAsync(body, signature, await getSecret("STRIPE_WEBHOOK_SECRET"));
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      if (session.mode === "subscription") {
        const userId = session.metadata?.user_id;
        if (userId && session.subscription) {
          await syncSubscription(stripe, supabase, session.subscription as string, userId);
        }
        return new Response(JSON.stringify({ received: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const productId = session.metadata?.product_id;
      const playerId = session.metadata?.player_id;
      const userId = session.metadata?.user_id;
      const sparks = Number(session.metadata?.sparks ?? 0);
      const sessionId = session.id;

      if (!playerId || !userId || !sparks || !productId) {
        return new Response(JSON.stringify({ error: "Missing metadata" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: order } = await supabase
        .from("orders")
        .select("id, status")
        .eq("stripe_checkout_session_id", sessionId)
        .maybeSingle();

      if (order && order.status === "paid") {
        return new Response(JSON.stringify({ received: true, already: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: wallet } = await supabase
        .from("wallet")
        .select("id, sparks, lifetime_sparks")
        .eq("player_id", playerId)
        .eq("user_id", userId)
        .maybeSingle();

      let walletId: string;

      if (wallet) {
        walletId = wallet.id;
        await supabase
          .from("wallet")
          .update({
            sparks: wallet.sparks + sparks,
            lifetime_sparks: wallet.lifetime_sparks + sparks,
            updated_at: new Date().toISOString(),
          })
          .eq("id", walletId);
      } else {
        const { data: newWallet } = await supabase
          .from("wallet")
          .insert({
            player_id: playerId,
            user_id: userId,
            sparks,
            lifetime_sparks: sparks,
          })
          .select("id")
          .single();
        walletId = newWallet?.id ?? "";
      }

      await supabase.from("spark_ledger").insert({
        wallet_id: walletId,
        delta: sparks,
        reason: "purchase",
        reference: sessionId,
      });

      if (order) {
        await supabase
          .from("orders")
          .update({ status: "paid", paid_at: new Date().toISOString() })
          .eq("id", order.id);
      }
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      await syncSubscription(stripe, supabase, subscription.id);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
