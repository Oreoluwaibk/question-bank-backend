import { Response, NextFunction, Request } from 'express';
import { User } from '@supabase/supabase-js';
import { supabasePublic } from '../services/supabasePublic';
import { isAccountActive, ACCOUNT_DEACTIVATED_MESSAGE } from '../services/accountService';

export interface AuthenticatedRequest extends Request {
  user: User;
}

async function authenticateRequest(req: Request, res: Response) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing token' });
    return false;
  }

  const token = authHeader.replace('Bearer ', '');

  const { data, error } = await supabasePublic.auth.getUser(token);

  if (error || !data.user) {
    res.status(401).json({ error: 'Invalid token' });
    return false;
  }

  req.user = data.user;
  return true;
}

async function ensureActiveAccount(
  userId: string,
  res: Response
): Promise<boolean> {
  try {
    if (!(await isAccountActive(userId))) {
      res.status(403).json({
        error: ACCOUNT_DEACTIVATED_MESSAGE,
        code: 'ACCOUNT_DEACTIVATED',
      });
      return false;
    }
  } catch (err) {
    console.error('Account status check failed:', err);
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Could not verify account status',
    });
    return false;
  }

  return true;
}

export async function requireAuthOnly(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authenticated = await authenticateRequest(req, res);
  if (!authenticated) {
    return;
  }

  next();
}

export async function requireActiveAccount(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!(await ensureActiveAccount(userId, res))) {
    return;
  }

  next();
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authenticated = await authenticateRequest(req, res);
  if (!authenticated) {
    return;
  }

  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!(await ensureActiveAccount(userId, res))) {
    return;
  }

  next();
}
