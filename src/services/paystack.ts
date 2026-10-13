import crypto from "crypto";
import type { BillingInterval } from "./subscriptionPlans";

const PAYSTACK_BASE_URL = "https://api.paystack.co";

export const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY ?? "";
const secretKey = process.env.PAYSTACK_SECRET_KEY;

if (!secretKey) {
  console.warn(
    "PAYSTACK_SECRET_KEY is not set — subscription checkout will be unavailable"
  );
}

export const PAYSTACK_CURRENCY = process.env.PAYSTACK_CURRENCY ?? "NGN";

function resolveAmountKobo(envValue: string | undefined, fallbackMajor: number) {
  const raw = Number(envValue ?? String(fallbackMajor));
  if (!Number.isFinite(raw) || raw <= 0) return fallbackMajor * 100;
  // Values under 100,000 are naira (5500 = ₦5,500, 55000 = ₦55,000).
  // Larger values are already kobo.
  if (raw < 100000) return Math.round(raw * 100);
  return Math.round(raw);
}

/** Monthly Pro price in kobo. Default ₦5,500. */
export const PAYSTACK_MONTHLY_AMOUNT = resolveAmountKobo(
  process.env.PAYSTACK_MONTHLY_AMOUNT ?? process.env.PAYSTACK_PRO_AMOUNT,
  5500
);

/** Yearly Pro price in kobo. Default ₦55,000 (~10 months). */
export const PAYSTACK_YEARLY_AMOUNT = resolveAmountKobo(
  process.env.PAYSTACK_YEARLY_AMOUNT,
  55000
);

/** @deprecated Prefer PAYSTACK_MONTHLY_AMOUNT */
export const PAYSTACK_PRO_AMOUNT = PAYSTACK_MONTHLY_AMOUNT;

export function paystackAmountMajor(amountKobo: number) {
  return Math.round(amountKobo / 100);
}

export function amountForInterval(interval: BillingInterval) {
  return interval === "yearly" ? PAYSTACK_YEARLY_AMOUNT : PAYSTACK_MONTHLY_AMOUNT;
}

type PaystackResponse<T> = {
  status: boolean;
  message: string;
  data: T;
};

export function requirePaystackSecret(): string {
  if (!secretKey) {
    throw new Error("Paystack is not configured on the server");
  }
  return secretKey;
}

export async function paystackRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const key = requirePaystackSecret();

  const response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  const body = (await response.json()) as PaystackResponse<T>;

  if (!response.ok || !body.status) {
    throw new Error(body.message || "Paystack request failed");
  }

  return body.data;
}

export function formatPaystackAmount(amount: number, currency: string) {
  const major = amount / 100;
  if (currency === "NGN") return `₦${major.toLocaleString("en-NG")}`;
  if (currency === "GHS") return `GH₵${major.toLocaleString("en-GH")}`;
  if (currency === "ZAR") return `R${major.toLocaleString("en-ZA")}`;
  if (currency === "USD") return `$${major.toLocaleString("en-US")}`;
  return `${major.toLocaleString()} ${currency}`;
}

export function verifyPaystackSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined
) {
  const key = requirePaystackSecret();
  if (!signatureHeader) return false;

  const hash = crypto.createHmac("sha512", key).update(rawBody).digest("hex");
  return hash === signatureHeader;
}

const cachedPlanCodes: Partial<Record<BillingInterval, string>> = {
  monthly:
    process.env.PAYSTACK_PLAN_CODE_MONTHLY ??
    process.env.PAYSTACK_PLAN_CODE ??
    undefined,
  yearly: process.env.PAYSTACK_PLAN_CODE_YEARLY ?? undefined,
};

export async function getOrCreatePaystackPlanCode(interval: BillingInterval) {
  const cached = cachedPlanCodes[interval];
  if (cached) return cached;

  const amount = amountForInterval(interval);
  // Paystack uses "annually" (not "yearly") for yearly plans.
  const paystackInterval = interval === "yearly" ? "annually" : "monthly";
  const plan = await paystackRequest<{ plan_code: string }>("/plan", {
    method: "POST",
    body: JSON.stringify({
      name:
        interval === "yearly"
          ? "Question Bank Pro (Yearly)"
          : "Question Bank Pro (Monthly)",
      interval: paystackInterval,
      amount,
      currency: PAYSTACK_CURRENCY,
      description:
        "Unlimited materials, attempts, timed tests, retakes, copy and export",
    }),
  });

  cachedPlanCodes[interval] = plan.plan_code;
  return plan.plan_code;
}

/**
 * Every Paystack Checkout method, card first so the page opens on a choice.
 * Methods the account has not enabled are removed if Paystack rejects them.
 */
const PAYSTACK_CHECKOUT_CHANNELS = [
  "card",
  "bank",
  "ussd",
  "qr",
  "bank_transfer",
  "mobile_money",
  "apple_pay",
  "eft",
  "payattitude",
  "capitec_pay",
];

let acceptedCheckoutChannels: string[] | null = null;

export type PaystackInitializeData = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

export type PaystackVerifyData = {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  customer?: {
    customer_code?: string;
    email?: string;
  };
  plan?: string | { plan_code?: string };
  subscription?: {
    subscription_code?: string;
    status?: string;
    next_payment_date?: string;
  };
  metadata?: Record<string, unknown>;
};

export async function initializePaystackTransaction(payload: {
  email: string;
  userId: string;
  callbackUrl: string;
  planCode: string;
  reference: string;
  interval: BillingInterval;
  amountKobo: number;
}) {
  const requestBody = {
    email: payload.email,
    amount: String(payload.amountKobo),
    currency: PAYSTACK_CURRENCY,
    plan: payload.planCode,
    reference: payload.reference,
    callback_url: payload.callbackUrl,
    metadata: {
      user_id: payload.userId,
      billing_interval: payload.interval,
    },
  };
  const remaining = [...(acceptedCheckoutChannels ?? PAYSTACK_CHECKOUT_CHANNELS)];

  while (remaining.length > 0) {
    try {
      const initialized = await paystackRequest<PaystackInitializeData>(
        "/transaction/initialize",
        {
          method: "POST",
          body: JSON.stringify({ ...requestBody, channels: remaining }),
        }
      );
      acceptedCheckoutChannels = [...remaining];
      return initialized;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const blocked = [...remaining]
        .sort((left, right) => right.length - left.length)
        .find((channel) => paystackErrorNamesChannel(message, channel));
      if (!blocked) throw error;
      remaining.splice(remaining.indexOf(blocked), 1);
      acceptedCheckoutChannels = null;
    }
  }

  throw new Error("Paystack has no payment channels enabled for this account");
}

function paystackErrorNamesChannel(message: string, channel: string) {
  const text = message.toLowerCase();
  return text.includes(channel) || text.includes(channel.split("_").join(" "));
}

export async function verifyPaystackTransaction(reference: string) {
  return paystackRequest<PaystackVerifyData>(
    `/transaction/verify/${encodeURIComponent(reference)}`
  );
}

export async function createPaystackCustomer(email: string, userId: string) {
  return paystackRequest<{ customer_code: string; email: string }>("/customer", {
    method: "POST",
    body: JSON.stringify({
      email,
      metadata: { user_id: userId },
    }),
  });
}

export type PaystackSubscriptionDetails = {
  subscription_code: string;
  email_token: string;
  status: string;
  next_payment_date?: string;
};

export async function fetchPaystackSubscription(subscriptionCode: string) {
  return paystackRequest<PaystackSubscriptionDetails>(
    `/subscription/${encodeURIComponent(subscriptionCode)}`
  );
}

export async function disablePaystackSubscription(
  subscriptionCode: string,
  emailToken: string
) {
  return paystackRequest<{ status: boolean }>("/subscription/disable", {
    method: "POST",
    body: JSON.stringify({
      code: subscriptionCode,
      token: emailToken,
    }),
  });
}
