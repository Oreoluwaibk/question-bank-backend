import { Request, Response, Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { supabaseAdmin } from '../services/supabaseAdmin';
import { uploadAvatarBuffer } from '../services/avatarStorage';
import { requireAuth, requireAuthOnly } from '../middlewares/auth';
import { supabasePublic } from '../services/supabasePublic';
import { provisionFreeSubscription } from '../services/subscriptionService';
import {
  registerDeviceSession,
  removeDeviceSession,
} from '../services/deviceSessionService';
import { deviceErrorResponse } from '../lib/deviceErrors';
import { accountErrorResponse } from '../lib/accountErrors';
import {
  assertAccountActive,
  deactivateAccount,
  getDeactivatedAt,
  ACCOUNT_DEACTIVATED_MESSAGE,
} from '../services/accountService';
import { validateRegistrationInput } from '../lib/authValidation';
import { getPublishedTermsVersion } from '../services/legalService';

const router = Router();

async function findDeactivatedAtByEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      return null;
    }

    const match = data.users.find(
      (user) => user.email?.toLowerCase() === normalizedEmail
    );

    if (match) {
      return getDeactivatedAt(match.id);
    }

    if (data.users.length < perPage) {
      return null;
    }

    page += 1;
  }
}

async function recordTermsAcceptance(userId: string) {
  const acceptedAt = new Date().toISOString();
  const termsVersion = await getPublishedTermsVersion();
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      terms_accepted_at: acceptedAt,
      terms_accepted_version: termsVersion,
    })
    .eq('id', userId);

  if (error) {
    throw error;
  }

  return { acceptedAt, termsVersion };
}

const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const avatarUpload = multer({
  dest: uploadsDir,
  limits: { fileSize: 5 * 1024 * 1024 },
});

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
  const { email, password, firstName, lastName, phoneNumber, acceptedTerms } = req.body;

  if (!acceptedTerms) {
    return res.status(400).json({
      error: 'You must accept the Terms & Conditions and Privacy Policy',
    });
  }

  const validationError = validateRegistrationInput({
    email,
    password,
    firstName,
    lastName,
    phoneNumber,
  });

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const { data, error } = await supabasePublic.auth.signUp({
    email: email.trim(),
    password,
    options: {
      emailRedirectTo: undefined // OTP only
    }
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  if (data.user?.id) {
    const acceptedAt = new Date().toISOString();
    const termsVersion = await getPublishedTermsVersion();
    const { error: profileError } = await supabaseAdmin.from('profiles').upsert(
      {
        id: data.user.id,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone_number: phoneNumber.trim(),
        terms_accepted_at: acceptedAt,
        terms_accepted_version: termsVersion,
      },
      { onConflict: 'id' }
    );

    if (profileError) {
      console.error('Failed to save profile on register:', profileError);
    }
  }

  res.json({
    message: 'OTP sent to email',
    userId: data.user?.id
  });
})
.post('/verify-otp', async (req: Request, res: Response) => {
  const { email, otp, deviceId, deviceName } = req.body;

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

  try {
    await assertAccountActive(userId);
  } catch (err) {
    const accountErr = accountErrorResponse(res, err);
    if (accountErr) return accountErr;
    throw err;
  }

  await provisionFreeSubscription(userId);

  try {
    await registerDeviceSession(userId, deviceId, {
      deviceName,
      refreshToken: data.session?.refresh_token,
    });
  } catch (err) {
    const deviceErr = deviceErrorResponse(res, err);
    if (deviceErr) return deviceErr;
    return res.status(400).json({
      error: err instanceof Error ? err.message : 'Could not register device',
    });
  }

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
  const { email, password, deviceId, deviceName } = req.body;

  const { data, error } = await supabasePublic.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    const deactivatedAt = await findDeactivatedAtByEmail(email);
    if (deactivatedAt) {
      return res.status(403).json({
        error: ACCOUNT_DEACTIVATED_MESSAGE,
        code: 'ACCOUNT_DEACTIVATED',
      });
    }
    return res.status(401).json({ error: error.message });
  }

  if (data.user?.id) {
    try {
      await assertAccountActive(data.user.id);
    } catch (err) {
      const accountErr = accountErrorResponse(res, err);
      if (accountErr) return accountErr;
      throw err;
    }

    try {
      await provisionFreeSubscription(data.user.id);
    } catch (provisionError) {
      console.error('Failed to provision subscription on login:', provisionError);
    }

    try {
      await registerDeviceSession(data.user.id, deviceId, {
        deviceName,
        refreshToken: data.session?.refresh_token,
      });
    } catch (err) {
      const deviceErr = deviceErrorResponse(res, err);
      if (deviceErr) return deviceErr;
      return res.status(400).json({
        error: err instanceof Error ? err.message : 'Could not register device',
      });
    }
  }

  return res.json({
    user: data.user,
    session: data.session
  });
})
.post('/logout', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { deviceId } = req.body as { deviceId?: string };

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await removeDeviceSession(userId, deviceId ?? '');
    res.json({ message: 'Logged out' });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Could not log out device',
    });
  }
})
.post('/deactivate', requireAuthOnly, async (req: Request, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { deactivatedAt } = await deactivateAccount(userId);
    res.json({
      message: 'Account deactivated',
      deactivatedAt,
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Could not deactivate account',
    });
  }
})
.post('/session/register', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { deviceId, deviceName, refreshToken } = req.body as {
    deviceId?: string;
    deviceName?: string;
    refreshToken?: string;
  };

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await provisionFreeSubscription(userId);
    await registerDeviceSession(userId, deviceId ?? '', {
      deviceName,
      refreshToken,
    });

    const [{ data: profile }, currentTermsVersion] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('terms_accepted_at, terms_accepted_version')
        .eq('id', userId)
        .maybeSingle(),
      getPublishedTermsVersion(),
    ]);

    const termsAccepted = Boolean(profile?.terms_accepted_at);
    const termsAcceptedVersion = profile?.terms_accepted_version ?? null;
    const needsTermsAcceptance =
      !termsAccepted || termsAcceptedVersion !== currentTermsVersion;

    res.json({
      message: 'Session registered',
      termsAccepted,
      termsAcceptedAt: profile?.terms_accepted_at ?? null,
      termsAcceptedVersion,
      currentTermsVersion,
      needsTermsAcceptance,
    });
  } catch (err) {
    const deviceErr = deviceErrorResponse(res, err);
    if (deviceErr) return deviceErr;
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Could not register session',
    });
  }
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

  if (data.user?.id) {
    try {
      await assertAccountActive(data.user.id);
    } catch (err) {
      const accountErr = accountErrorResponse(res, err);
      if (accountErr) return accountErr;
      throw err;
    }
  }

  await supabasePublic.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token
  });

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
.post('/accept-terms', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { acceptedAt, termsVersion } = await recordTermsAcceptance(userId);
    res.json({
      message: 'Terms accepted',
      terms_accepted_at: acceptedAt,
      terms_accepted_version: termsVersion,
    });
  } catch (err: any) {
    return res.status(400).json({
      error: err.message ?? 'Could not record terms acceptance',
    });
  }
})
.put('/me', requireAuth, async (req, res) => {
  const userId = req.user?.id;
  const {
    terms_accepted_at: _ignoredTermsAt,
    terms_accepted_version: _ignoredTermsVersion,
    ...updates
  } = req.body;

  const { error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', userId);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({ message: 'Profile updated' });
});

async function saveAvatarFromBuffer(
  userId: string,
  buffer: Buffer,
  mime: string,
  res: Response
) {
  if (!mime.startsWith('image/')) {
    return res.status(415).json({ error: 'Only image files are allowed' });
  }

  if (!buffer.length) {
    return res.status(400).json({ error: 'Uploaded image is empty' });
  }

  try {
    const avatarUrl = await uploadAvatarBuffer(userId, buffer, mime);

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({ avatar_url: avatarUrl })
      .eq('id', userId);

    if (profileError) {
      return res.status(400).json({ error: profileError.message });
    }

    res.json({ avatar_url: avatarUrl });
  } catch (err: any) {
    return res.status(400).json({
      error: err.message ?? 'Could not save profile picture',
    });
  }
}

router
.post('/me/avatar/document', requireAuth, async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data, mimeType } = req.body as {
    data?: string;
    mimeType?: string;
  };

  if (!data) {
    return res.status(400).json({ error: 'No image data provided' });
  }

  try {
    const buffer = Buffer.from(data, 'base64');
    const mime = mimeType?.startsWith('image/') ? mimeType : 'image/jpeg';
    return saveAvatarFromBuffer(userId, buffer, mime, res);
  } catch {
    return res.status(400).json({ error: 'Invalid image data' });
  }
})
.post('/me/avatar', requireAuth, avatarUpload.single('avatar'), async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded' });
  }

  const mime = req.file.mimetype ?? 'image/jpeg';

  try {
    const buffer = fs.readFileSync(req.file.path);
    return saveAvatarFromBuffer(userId, buffer, mime, res);
  } catch {
    return res.status(500).json({ error: 'Failed to read uploaded image' });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

export default router;
