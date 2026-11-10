
import { put, get, del } from '@vercel/blob';

function assertConfigured() {
  if (!storageIsConfigured()) {
    throw new Error('Vercel Blob não está configurado.');
  }
}

function validatePathname(pathname) {
  if (
    typeof pathname !== 'string' ||
    !pathname.trim() ||
    pathname.startsWith('/') ||
    pathname.includes('\\') ||
    pathname.split('/').some(
      (part) => !part || part === '.' || part === '..'
    )
  ) {
    throw new Error('Caminho de armazenamento inválido.');
  }

  return pathname;
}

export function storageIsConfigured() {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
    (
      process.env.VERCEL_OIDC_TOKEN &&
      process.env.BLOB_STORE_ID
    )
  );
}

export async function uploadPrivateBlob({
  pathname,
  body,
  contentType,
}) {
  assertConfigured();

  validatePathname(pathname);

  if (!body || !body.length) {
    throw new Error('Arquivo vazio.');
  }

  const allowedTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
  ];

  if (!allowedTypes.includes(contentType)) {
    throw new Error('Tipo de arquivo não permitido.');
  }

  const blob = await put(
    pathname,
    new Uint8Array(body),
    {
      access: 'private',
      contentType,
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
      multipart: body.length >= 5 * 1024 * 1024,
    }
  );

  return {
    pathname: blob.pathname,
    contentType: blob.contentType,
    etag: blob.etag,
  };
}

export async function getPrivateBlob(pathname) {
  assertConfigured();

  validatePathname(pathname);

  const result = await get(pathname, {
    access: 'private',
    useCache: false,
  });

  if (
    !result ||
    result.statusCode !== 200 ||
    !result.stream
  ) {
    return null;
  }

  return {
    stream: result.stream,
    contentType: result.blob.contentType,
    sizeBytes: result.blob.size,
    etag: result.blob.etag,
  };
}

export async function deletePrivateBlob(pathname) {
  assertConfigured();

  validatePathname(pathname);

  await del(pathname);
}
