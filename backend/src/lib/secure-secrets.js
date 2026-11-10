
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

function getEncryptionKey() {
  const value = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY || '';

  if (!/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error(
      'INTEGRATION_TOKEN_ENCRYPTION_KEY deve conter exatamente 64 caracteres hexadecimais.'
    );
  }

  return Buffer.from(value, 'hex');
}

export function encryptSecret(value) {
  if (typeof value !== 'string' || !value) {
    throw new Error('Não é possível criptografar um segredo vazio.');
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);

  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptSecret(value) {
  const parts = String(value).split('.');

  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Formato de credencial criptografada inválido.');
  }

  const [, ivValue, tagValue, encryptedValue] = parts;

  const decipher = createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivValue, 'base64url')
  );

  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
