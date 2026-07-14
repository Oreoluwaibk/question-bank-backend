import { supabaseAdmin } from './supabaseAdmin';

export const AVATAR_BUCKET = 'avatars';

let bucketReady: Promise<void> | null = null;

export async function ensureAvatarsBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = createAvatarsBucketIfNeeded();
  }
  await bucketReady;
}

async function createAvatarsBucketIfNeeded(): Promise<void> {
  const { data: buckets, error: listError } =
    await supabaseAdmin.storage.listBuckets();

  if (listError) {
    throw new Error(`Could not list storage buckets: ${listError.message}`);
  }

  if (buckets?.some((bucket) => bucket.name === AVATAR_BUCKET)) {
    return;
  }

  const { error: createError } = await supabaseAdmin.storage.createBucket(
    AVATAR_BUCKET,
    {
      public: true,
      fileSizeLimit: 5 * 1024 * 1024,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    }
  );

  if (createError && !createError.message.toLowerCase().includes('already exists')) {
    throw new Error(
      `Could not create "${AVATAR_BUCKET}" storage bucket: ${createError.message}`
    );
  }
}

export async function uploadAvatarBuffer(
  userId: string,
  buffer: Buffer,
  mime: string
): Promise<string> {
  await ensureAvatarsBucket();

  const ext = mime.includes('png') ? 'png' : 'jpg';
  const storagePath = `${userId}/avatar.${ext}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(AVATAR_BUCKET)
    .upload(storagePath, buffer, {
      upsert: true,
      contentType: mime,
    });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { data: urlData } = supabaseAdmin.storage
    .from(AVATAR_BUCKET)
    .getPublicUrl(storagePath);

  return `${urlData.publicUrl}?t=${Date.now()}`;
}
