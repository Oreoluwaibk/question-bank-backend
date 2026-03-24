import { Request, Response, Router } from 'express';
import { supabaseAdmin } from '../services/supabaseAdmin';
import { requireAuth } from '../middlewares/auth';
import { supabasePublic } from '../services/supabasePublic';


const router = Router();

router.post('/signup', async (req, res) => {
  const {
    email,
    password,
    phone,
    firstName,
    lastName,
    fieldOfStudy,
    occupation
  } = req.body;

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    phone,
    email_confirm: true
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  // update profile (row already exists via trigger)
  await supabaseAdmin
    .from('profiles')
    .update({
      first_name: firstName,
      last_name: lastName,
      field_of_study: fieldOfStudy,
      occupation
    })
    .eq('id', data.user.id);

  return res.status(201).json({
    message: 'User created',
    userId: data.user.id
  });
})
.post('/register', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const { data, error } = await supabasePublic.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: undefined // OTP only
    }
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({
    message: 'OTP sent to email',
    userId: data.user?.id
  });
})
.post('/verify-otp', async (req: Request, res: Response) => {
  const { email, otp } = req.body;

  const { data, error } = await supabasePublic.auth.verifyOtp({
    email,
    token: otp,
    type: 'email'
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  const userId = data.user?.id;

  if (!userId) {
    return res.status(500).json({ error: 'User not found after verification' });
  }

  // 🔐 Auto-provision FREE subscription (idempotent)
  await supabaseAdmin
    .from('subscriptions')
    .upsert({
      user_id: userId,
      tier: 'FREE',
      material_limit: 2,
      attempt_limit: 1,
      allow_reattempt: false,
      allow_timed: false
    });

  res.json({
    accessToken: data.session?.access_token,
    refreshToken: data.session?.refresh_token,
    user: data.user
  });
})
.post(
  '/complete-profile',
  requireAuth,
  async (req: Request, res: Response) => {
    const authReq = req as any;
    const { firstName, lastName, fieldOfStudy, occupation, phoneNumber } = req.body;

    const { error } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: authReq.user.id,
        first_name: firstName,
        last_name: lastName,
        field_of_study: fieldOfStudy,
        occupation,
        phone_number: phoneNumber
      });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'Profile created' });
  }
)
.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabasePublic.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    return res.status(401).json({ error: error.message });
  }

  return res.json({
    user: data.user,
    session: data.session
  });
})
.post('/forgot-password', async (req: Request, res: Response) => {
  const { email } = req.body as { email: string };

  const { error } = await supabasePublic.auth.resetPasswordForEmail(email);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({ message: 'OTP sent to email' });
})
.post('/reset-password', async (req: Request, res: Response) => {
  const { email, otp, newPassword } = req.body as {
    email: string;
    otp: string;
    newPassword: string;
  };

  // 1️⃣ Verify OTP
  const { data, error: verifyError } =
    await supabasePublic.auth.verifyOtp({
      email,
      token: otp,
      type: 'recovery'
    });

  if (verifyError || !data.session) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }

  // 2️⃣ Update password (user-context)
  const { error: updateError } =
    await supabasePublic.auth.updateUser({
      password: newPassword
    });

  if (updateError) {
    return res.status(400).json({ error: updateError.message });
  }

  res.json({
    message: 'Password reset successful',
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token
  });
})
.get('/me', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user?.id;

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
})
.put('/me', requireAuth, async (req, res) => {
  const userId = req.user?.id;
  const updates = req.body;

  const { error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', userId);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({ message: 'Profile updated' });
});

export default router;
