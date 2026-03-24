import { Response, NextFunction, Request } from 'express';
import { supabasePublic } from '../services/supabasePublic';
import { User } from '@supabase/supabase-js';

export interface AuthenticatedRequest extends Request {
  user: User;
}

// export async function requireAuth(
//   req: any,
//   res: Response,
//   next: NextFunction
// ): Promise<void> {
//   const authHeader = req.headers.authorization;

//   if (!authHeader?.startsWith('Bearer ')) {
//     res.status(401).json({ error: 'Missing token' });
//     return;
//   }

//   const token = authHeader.replace('Bearer ', '');

//   const { data, error } = await supabasePublic.auth.getUser(token);

//   if (error || !data.user) {
//     res.status(401).json({ error: 'Invalid token' });
//     return;
//   }

//   // 🔑 ASSERT the type here
//   (req as AuthenticatedRequest).user = data.user;

//   next();
// }
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }

  const token = authHeader.replace('Bearer ', '');

  const { data, error } = await supabasePublic.auth.getUser(token);

  if (error || !data.user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  req.user = data.user; // ✅ now valid
  next();
}

