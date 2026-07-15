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
import {
  profileNamesFromAuthUser,
  recordTermsAcceptance,
  updateUserProfile,
} from '../services/profileService';
import { createDeletionRequest } from '../services/deletionRequestService';

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

const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const avatarUpload = multer({
  dest: uploadsDir,
  limits: { fileSize: 5 * 1024 * 1024 },
});

function isDuplicateSignup(user: { identities?: unknown[] } | null | undefined) {
  return Boolean(
    user && Array.isArray(user.identities) && user.identities.length === 0
  );
}

async function saveRegistrationProfile(
  userId: string,
  profile: {
    firstName: string;
    lastName: string;
    phoneNumber: string;
  }
) {
  const acceptedAt = new Date().toISOString();
  const termsVersion = await getPublishedTermsVersion();
  const { error } = await supabaseAdmin.from('profiles').upsert(
    {
      id: userId,
      first_name: profile.firstName.trim(),
      last_name: profile.lastName.trim(),
      phone_number: profile.phoneNumber.trim(),
      terms_accepted_at: acceptedAt,
      terms_accepted_version: termsVersion,
    },
    { onConflict: 'id' }
  );

  if (error) {
    throw new Error(error.message);
  }
}

async function resendSignupOtp(email: string) {
  return supabasePublic.auth.resend({
    type: 'signup',
    email: email.trim(),
  });
}

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
  const normalizedEmail = String(email ?? '').trim();

  if (!acceptedTerms) {
    return res.status(400).json({
      error: 'You must accept the Terms & Conditions and Privacy Policy',
    });
  }

  const validationError = validateRegistrationInput({
    email: normalizedEmail,
    password,
    firstName,
    lastName,
    phoneNumber,
  });

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const profilePayload = {
    firstName: String(firstName).trim(),
    lastName: String(lastName).trim(),
    phoneNumber: String(phoneNumber).trim(),
  };

  const startedAt = Date.now();
  const { data, error } = await supabasePublic.auth.signUp({
    email: normalizedEmail,
    password,
    options: {
      data: {
        first_name: profilePayload.firstName,
        last_name: profilePayload.lastName,
        phone_number: profilePayload.phoneNumber,
      },
    },
  });

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes('already registered') || message.includes('already exists')) {
      const { error: resendError } = await resendSignupOtp(normalizedEmail);
      if (resendError) {
        return res.status(400).json({
          error:
            'An account with this email already exists. Sign in or use forgot password.',
        });
      }

      return res.json({
        message: 'Verification code resent to your email',
        resent: true,
      });
    }

    return res.status(400).json({ error: error.message });
  }

  const duplicateSignup = isDuplicateSignup(data.user);
  if (duplicateSignup) {
    const { error: resendError } = await resendSignupOtp(normalizedEmail);
    if (resendError) {
      return res.status(400).json({
        error:
          'An account with this email already exists. Sign in or use forgot password.',
      });
    }

    console.log(
      `[auth/register] Existing unverified account, resent OTP in ${Date.now() - startedAt}ms`
    );

    return res.json({
      message: 'Verification code resent to your email',
      resent: true,
    });
  }

  if (data.session?.access_token && data.user?.id) {
    void saveRegistrationProfile(data.user.id, profilePayload).catch((err) => {
      console.error('Failed to save profile on register:', err);
    });
    void provisionFreeSubscription(data.user.id).catch((err) => {
      console.error('Failed to provision subscription on register:', err);
    });

    console.log(
      `[auth/register] Auto-confirmed signup in ${Date.now() - startedAt}ms`
    );

    return res.json({
      message: 'Account created',
      userId: data.user.id,
      autoConfirmed: true,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    });
  }

  if (data.user?.id) {
    void saveRegistrationProfile(data.user.id, profilePayload).catch((err) => {
      console.error('Failed to save profile on register:', err);
    });
  }

  console.log(
    `[auth/register] Signup complete, OTP requested in ${Date.now() - startedAt}ms`,
    {
      userId: data.user?.id ?? null,
      identities: data.user?.identities?.length ?? 0,
    }
  );

  res.json({
    message: 'Verification code sent to your email',
    userId: data.user?.id,
  });
})
.post('/resend-otp', async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };
  const normalizedEmail = email?.trim();

  if (!normalizedEmail) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const { error } = await resendSignupOtp(normalizedEmail);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({ message: 'Verification code resent to your email' });
})
.post('/verify-otp', async (req: Request, res: Response) => {
  const { email, otp, deviceId, deviceName } = req.body;
  const normalizedEmail = String(email ?? '').trim();
  const token = String(otp ?? '').trim();

  if (!normalizedEmail || !token) {
    return res.status(400).json({ error: 'Email and verification code are required' });
  }

  let data;
  let error;

  ({ data, error } = await supabasePublic.auth.verifyOtp({
    email: normalizedEmail,
    token,
    type: 'signup',
  }));

  if (error) {
    ({ data, error } = await supabasePublic.auth.verifyOtp({
      email: normalizedEmail,
      token,
      type: 'email',
    }));
  }

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
.post('/request-deletion', requireAuthOnly, async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const email = req.user?.email;
  const { reason } = req.body as { reason?: string };

  if (!userId || !email) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { request, alreadyPending } = await createDeletionRequest({
      email,
      userId,
      reason,
      source: 'app',
    });

    res.json({
      message: alreadyPending
        ? 'Your deletion request is already pending review.'
        : 'Deletion request submitted. We will permanently delete your account and data within 30 days.',
      requestId: request.id,
      alreadyPending,
    });
  } catch (err) {
    res.status(400).json({
      error:
        err instanceof Error ? err.message : 'Could not submit deletion request',
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
    const message =
      err instanceof Error ? err.message : 'Could not record terms acceptance';
    console.error('Accept terms failed:', err);
    return res.status(/column|schema|relation/i.test(message) ? 500 : 400).json({
      error: message,
    });
  }
})
.put('/me', requireAuth, async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = { ...(req.body as Record<string, unknown>) };
    delete body.terms_accepted_at;
    delete body.terms_accepted_version;

    const profile = await updateUserProfile(userId, body);
    res.json(profile);
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : 'Could not update profile',
    });
  }
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
    const profile = await updateUserProfile(userId, { avatar_url: avatarUrl });

    res.json({
      avatar_url: profile.avatar_url ?? avatarUrl,
      profile,
    });
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
