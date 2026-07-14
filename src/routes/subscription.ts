import { Router, Request, Response } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabaseAdmin } from "../services/supabaseAdmin";
import {
  applyFreeSubscription,
  applyProSubscription,
  getOrCreateSubscription,
  getSubscriptionStatus,
} from "../services/subscriptionService";
import {
  disablePaystackSubscription,
  fetchPaystackSubscription,
  createPaystackCustomer,
  formatPaystackAmount,
  getOrCreatePaystackPlanCode,
  initializePaystackTransaction,
  paystackAmountMajor,
  PAYSTACK_CURRENCY,
  PAYSTACK_PRO_AMOUNT,
  PAYSTACK_PUBLIC_KEY,
  verifyPaystackSignature,
  verifyPaystackTransaction,
} from "../services/paystack";
import { FREE_PLAN, PRO_PLAN } from "../services/subscriptionPlans";

const router = Router();
const APP_SCHEME = process.env.APP_SCHEME ?? "questionapp";

async function getUserEmail(userId: string) {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error || !data.user?.email) {
    throw new Error("Could not load account email for checkout");
  }
  return data.user.email;
}

async function resolvePaystackCustomer(userId: string, email: string) {
  const subscription = await getOrCreateSubscription(userId);

  if (subscription.stripe_customer_id) {
    return subscription.stripe_customer_id;
  }

  const customer = await createPaystackCustomer(email, userId);

  await supabaseAdmin
    .from("subscriptions")
    .update({ stripe_customer_id: customer.customer_code })
    .eq("user_id", userId);

  return customer.customer_code;
}

function readMetadataUserId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const userId = (metadata as Record<string, unknown>).user_id;
  return typeof userId === "string" ? userId : null;
}

async function activateProFromVerification(
  userId: string,
  verification: Awaited<ReturnType<typeof verifyPaystackTransaction>>
) {
  const customerCode = verification.customer?.customer_code ?? "unknown";
  const subscriptionCode =
    verification.subscription?.subscription_code ?? verification.reference;
  const status = verification.subscription?.status ?? "active";
  const nextPayment = verification.subscription?.next_payment_date
    ? new Date(verification.subscription.next_payment_date)
    : null;

  await applyProSubscription(
    userId,
    customerCode,
    subscriptionCode,
    status,
    nextPayment
  );
}

router.get("/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const status = await getSubscriptionStatus(req.user!.id);
    res.json({
      ...status,
      publishableKey: PAYSTACK_PUBLIC_KEY,
      provider: "paystack",
      pricing: {
        amount: PAYSTACK_PRO_AMOUNT,
        currency: PAYSTACK_CURRENCY,
        displayAmount: formatPaystackAmount(
          PAYSTACK_PRO_AMOUNT,
          PAYSTACK_CURRENCY
        ),
        interval: "monthly",
      },
      plans: {
        free: FREE_PLAN,
        pro: PRO_PLAN,
      },
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Could not load subscription",
    });
  }
});

router.post("/checkout", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const status = await getSubscriptionStatus(userId);

    if (status.isPro) {
      return res.status(400).json({ error: "You already have an active subscription" });
    }

    const email = await getUserEmail(userId);
    const customerCode = await resolvePaystackCustomer(userId, email);
    const planCode = await getOrCreatePaystackPlanCode();

    const initialized = await initializePaystackTransaction({
      email,
      userId,
      customerCode,
      planCode,
      callbackUrl: `${APP_SCHEME}://subscription/success`,
    });

    res.json({
      reference: initialized.reference,
      accessCode: initialized.access_code,
      publicKey: PAYSTACK_PUBLIC_KEY,
      email,
      amount: paystackAmountMajor(),
      currency: PAYSTACK_CURRENCY,
      planCode,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Checkout failed",
    });
  }
});

router.post("/cancel", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const status = await getSubscriptionStatus(userId);

    if (!status.isPro) {
      return res.status(400).json({ error: "No active subscription to cancel" });
    }

    const subscription = await getOrCreateSubscription(userId);
    const paystackCode = subscription.stripe_subscription_id;

    if (paystackCode) {
      try {
        const paystackSub = await fetchPaystackSubscription(paystackCode);
        if (paystackSub.email_token) {
          await disablePaystackSubscription(
            paystackSub.subscription_code ?? paystackCode,
            paystackSub.email_token
          );
        }
      } catch (paystackError) {
        console.error("Paystack cancel failed, downgrading locally:", paystackError);
      }
    }

    await applyFreeSubscription(userId);

    const updated = await getSubscriptionStatus(userId);
    res.json({
      message: "Subscription cancelled. You are now on the free plan.",
      ...updated,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Could not cancel subscription",
    });
  }
});

router.post("/verify", requireAuth, async (req: Request, res: Response) => {
  const { reference } = req.body as { reference?: string };

  if (!reference) {
    return res.status(400).json({ error: "reference is required" });
  }

  try {
    const verification = await verifyPaystackTransaction(reference);

    if (verification.status !== "success") {
      return res.status(400).json({ error: "Payment not completed yet" });
    }

    const metadataUserId = readMetadataUserId(verification.metadata);

    if (metadataUserId && metadataUserId !== req.user!.id) {
      return res.status(403).json({ error: "Payment does not belong to this user" });
    }

    await activateProFromVerification(req.user!.id, verification);

    const status = await getSubscriptionStatus(req.user!.id);
    res.json({ message: "Subscription activated", ...status });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Could not verify payment",
    });
  }
});

export async function handlePaystackWebhook(req: Request, res: Response) {
  const signature = req.headers["x-paystack-signature"];
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");

  try {
    if (!verifyPaystackSignature(rawBody, String(signature ?? ""))) {
      return res.status(400).json({ error: "Invalid Paystack signature" });
    }
  } catch {
    return res.status(503).json({ error: "Paystack is not configured" });
  }

  let event: { event?: string; data?: Record<string, unknown> };

  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid webhook payload" });
  }

  try {
    const eventName = event.event;
    const data = event.data ?? {};

    if (eventName === "charge.success") {
      const userId = readMetadataUserId(data.metadata);
      if (userId && data.status === "success") {
        await activateProFromVerification(userId, {
          status: "success",
          reference: String(data.reference ?? ""),
          amount: Number(data.amount ?? 0),
          currency: String(data.currency ?? PAYSTACK_CURRENCY),
          customer: data.customer as PaystackVerifyCustomer,
          subscription: data.subscription as PaystackVerifySubscription,
          metadata: data.metadata as Record<string, unknown>,
        });
      }
    }

    if (eventName === "subscription.disable") {
      const subscriptionCode = String(data.subscription_code ?? "");
      if (subscriptionCode) {
        const { data: row } = await supabaseAdmin
          .from("subscriptions")
          .select("user_id")
          .eq("stripe_subscription_id", subscriptionCode)
          .maybeSingle();

        if (row?.user_id) {
          await applyFreeSubscription(row.user_id);
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Paystack webhook error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Webhook handler failed",
    });
  }
}

type PaystackVerifyCustomer = {
  customer_code?: string;
  email?: string;
};

type PaystackVerifySubscription = {
  subscription_code?: string;
  status?: string;
  next_payment_date?: string;
};

export default router;
