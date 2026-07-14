import { NextFunction, Request, Response } from "express";
import { supabasePublic } from "../services/supabasePublic";

function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const adminSecret = process.env.ADMIN_API_SECRET?.trim();
  const headerSecret = req.headers["x-admin-secret"];

  if (
    adminSecret &&
    typeof headerSecret === "string" &&
    headerSecret === adminSecret
  ) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Admin authentication required" });
  }

  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await supabasePublic.auth.getUser(token);

  if (error || !data.user?.email) {
    return res.status(401).json({ error: "Invalid admin token" });
  }

  const allowedEmails = getAdminEmails();
  if (
    allowedEmails.length === 0 ||
    !allowedEmails.includes(data.user.email.toLowerCase())
  ) {
    return res.status(403).json({ error: "Not authorized as admin" });
  }

  req.user = data.user;
  next();
}
