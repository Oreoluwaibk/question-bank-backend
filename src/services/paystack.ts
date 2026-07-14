import crypto from "crypto";

const PAYSTACK_BASE_URL = "https://api.paystack.co";

export const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY ?? "";
const secretKey = process.env.PAYSTACK_SECRET_KEY;

if (!secretKey) {
  console.warn(
    "PAYSTACK_SECRET_KEY is not set — subscription checkout will be unavailable"
  );
}

export const PAYSTACK_CURRENCY = process.env.PAYSTACK_CURRENCY ?? "NGN";
export const PAYSTACK_PRO_AMOUNT = resolveProAmountKobo();

function resolveProAmountKobo(): number {
  const raw = Number(process.env.PAYSTACK_PRO_AMOUNT ?? "500000");
  if (!Number.isFinite(raw) || raw <= 0) return 500000;
  // Treat small values as major units (5000 -> ₦5,000 = 500000 kobo).
  if (raw < 10000) return Math.round(raw * 100);
  return Math.round(raw);
}

export function paystackAmountMajor(amountKobo = PAYSTACK_PRO_AMOUNT) {
  return Math.round(amountKobo / 100);
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

let cachedPlanCode: string | null = process.env.PAYSTACK_PLAN_CODE ?? null;

export async function getOrCreatePaystackPlanCode() {
  if (cachedPlanCode) {
    return cachedPlanCode;
  }

  const plan = await paystackRequest<{ plan_code: string }>("/plan", {
    method: "POST",
    body: JSON.stringify({
      name: "Question Bank Pro",
      interval: "monthly",
      amount: PAYSTACK_PRO_AMOUNT,
      currency: PAYSTACK_CURRENCY,
      description: "Unlimited materials, attempts, timed tests, and retakes",
    }),
  });

  cachedPlanCode = plan.plan_code;
  return cachedPlanCode;
}

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
  customerCode?: string;
}) {
  return paystackRequest<PaystackInitializeData>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: payload.email,
      amount: String(PAYSTACK_PRO_AMOUNT),
      currency: PAYSTACK_CURRENCY,
      plan: payload.planCode,
      callback_url: payload.callbackUrl,
      customer: payload.customerCode,
      metadata: {
        user_id: payload.userId,
      },
    }),
  });
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
