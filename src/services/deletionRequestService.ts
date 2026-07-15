import { supabaseAdmin } from "./supabaseAdmin";
import { deleteAccountPermanently } from "./accountService";

export type DeletionRequestStatus =
  | "pending"
  | "processing"
  | "completed"
  | "rejected";

export type DeletionRequestRow = {
  id: string;
  user_id: string | null;
  email: string;
  reason: string | null;
  source: string;
  status: DeletionRequestStatus;
  admin_notes: string | null;
  requested_at: string;
  processed_at: string | null;
};

export const DELETION_INFO = {
  appName: "Question Bank",
  supportEmail: "oreoluwa.creatives@gmail.com",
  processingDays: 30,
  deletedData: [
    "Account profile (name, email, phone, avatar, study preferences)",
    "Uploaded study materials and extracted document text",
    "Generated and saved practice questions",
    "Test attempts, scores, and analytics",
    "Subscription and device session records",
  ],
  retainedData: [
    "Payment records required for tax, fraud prevention, or legal compliance may be kept for up to 7 years where applicable.",
    "Anonymized aggregate statistics that cannot identify you.",
  ],
};

async function findUserIdByEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw new Error(error.message);
    }

    const match = data.users.find(
      (user) => user.email?.toLowerCase() === normalizedEmail
    );

    if (match) {
      return match.id;
    }

    if (data.users.length < perPage) {
      return null;
    }

    page += 1;
  }
}

async function findPendingRequest(email: string, userId?: string | null) {
  const normalizedEmail = email.trim().toLowerCase();

  if (userId) {
    const { data, error } = await supabaseAdmin
      .from("account_deletion_requests")
      .select("*")
      .eq("status", "pending")
      .eq("user_id", userId)
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (/account_deletion_requests/i.test(error.message)) {
        return null;
      }
      throw new Error(error.message);
    }

    if (data) {
      return data as DeletionRequestRow;
    }
  }

  const { data, error } = await supabaseAdmin
    .from("account_deletion_requests")
    .select("*")
    .eq("status", "pending")
    .ilike("email", normalizedEmail)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (/account_deletion_requests/i.test(error.message)) {
      return null;
    }
    throw new Error(error.message);
  }

  return (data as DeletionRequestRow | null) ?? null;
}

export async function createDeletionRequest(input: {
  email: string;
  userId?: string | null;
  reason?: string | null;
  source?: "app" | "web";
}) {
  const email = input.email.trim();
  const normalizedEmail = email.toLowerCase();

  if (!email) {
    throw new Error("Email is required");
  }

  const userId =
    input.userId ?? (await findUserIdByEmail(normalizedEmail));

  const existing = await findPendingRequest(email, userId);
  if (existing) {
    return {
      request: existing,
      alreadyPending: true,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("account_deletion_requests")
    .insert({
      user_id: userId,
      email: normalizedEmail,
      reason: input.reason?.trim() || null,
      source: input.source ?? "web",
      status: "pending",
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return {
    request: data as DeletionRequestRow,
    alreadyPending: false,
  };
}

export async function listDeletionRequests(options?: {
  status?: DeletionRequestStatus;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(options?.page ?? 1, 1);
  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 50);
  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from("account_deletion_requests")
    .select("*", { count: "exact" })
    .order("requested_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  const { data, error, count } = await query;

  if (error) {
    if (/account_deletion_requests/i.test(error.message)) {
      return { requests: [], total: 0, page, limit };
    }
    throw new Error(error.message);
  }

  return {
    requests: (data ?? []) as DeletionRequestRow[],
    total: count ?? 0,
    page,
    limit,
  };
}

export async function getDeletionRequestById(id: string) {
  const { data, error } = await supabaseAdmin
    .from("account_deletion_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Deletion request not found");
  }

  return data as DeletionRequestRow;
}

export async function updateDeletionRequestStatus(
  id: string,
  status: DeletionRequestStatus,
  adminNotes?: string | null
) {
  const { data, error } = await supabaseAdmin
    .from("account_deletion_requests")
    .update({
      status,
      admin_notes: adminNotes?.trim() || null,
      processed_at: ["completed", "rejected"].includes(status)
        ? new Date().toISOString()
        : null,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as DeletionRequestRow;
}

export async function completeDeletionRequest(id: string, adminNotes?: string) {
  const request = await getDeletionRequestById(id);

  if (request.status === "completed") {
    return request;
  }

  let userId = request.user_id;

  if (!userId) {
    userId = await findUserIdByEmail(request.email);
  }

  if (userId) {
    await deleteAccountPermanently(userId);
  }

  return updateDeletionRequestStatus(id, "completed", adminNotes);
}

export async function countPendingDeletionRequests() {
  const { count, error } = await supabaseAdmin
    .from("account_deletion_requests")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  if (error) {
    if (/account_deletion_requests/i.test(error.message)) {
      return 0;
    }
    throw new Error(error.message);
  }

  return count ?? 0;
}
