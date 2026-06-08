import { env } from "../config/env.js";

/**
 * Minimal client for the Recurrente REST API.
 * Docs: https://docs.recurrente.com
 *
 * We create checkouts server-side (instead of using static product links) so we
 * can map the returned checkout id back to the salon that started it. The
 * webhook then activates the exact account by checkout id — the customer can pay
 * with ANY email and it still lands on the right subscription.
 */

const API_BASE = "https://app.recurrente.com/api";

export type CheckoutPlan = "MONTHLY" | "YEARLY" | "LIFETIME";

export type CreatedCheckout = { id: string; url: string };

function planName(plan: CheckoutPlan): string {
  switch (plan) {
    case "LIFETIME":
      return "Ecodama — Plan Lifetime";
    case "YEARLY":
      return "Ecodama — Plan Anual";
    case "MONTHLY":
      return "Ecodama — Plan Mensual";
  }
}

/**
 * Creates a hosted checkout and returns its id + url.
 * Throws on any failure so the caller can fall back to a static link.
 */
export async function createRecurrenteCheckout(params: {
  plan: CheckoutPlan;
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
}): Promise<CreatedCheckout> {
  if (!env.RECURRENTE_SECRET_KEY) {
    throw new Error("RECURRENTE_SECRET_KEY not configured");
  }

  const { plan, amountCents, successUrl, cancelUrl } = params;

  // Build the line item. Monthly/Yearly are recurring subscriptions; Lifetime
  // is a one-time charge (no recurring fields).
  const item: Record<string, unknown> = {
    name: planName(plan),
    currency: "USD",
    amount_in_cents: amountCents,
    quantity: 1,
  };
  if (plan !== "LIFETIME") {
    item.charge_type = "recurring";
    item.billing_interval = plan === "YEARLY" ? "year" : "month";
    item.billing_interval_count = 1;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-SECRET-KEY": env.RECURRENTE_SECRET_KEY,
  };
  // Some Recurrente accounts also require the public key header.
  if (env.RECURRENTE_PUBLIC_KEY) headers["X-PUBLIC-KEY"] = env.RECURRENTE_PUBLIC_KEY;

  const res = await fetch(`${API_BASE}/checkouts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      items: [item],
      success_url: successUrl,
      cancel_url: cancelUrl,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Recurrente checkout failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  // Response field naming isn't fully pinned in the public docs, so accept the
  // documented `checkout_url`/`id` plus a couple of common aliases.
  const url =
    (data.checkout_url as string) ||
    (data.url as string) ||
    ((data.checkout as Record<string, unknown>)?.url as string);
  const id =
    (data.id as string) ||
    (data.checkout_id as string) ||
    ((data.checkout as Record<string, unknown>)?.id as string);

  if (!url || !id) {
    throw new Error(`Recurrente response missing url/id: ${JSON.stringify(data)}`);
  }
  return { id, url };
}
