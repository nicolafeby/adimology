import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';

function encryptionKey(): Buffer {
  const configured = process.env.TOKEN_ENCRYPTION_KEY;
  if (!configured) {
    throw new Error('TOKEN_ENCRYPTION_KEY is required to store sensitive session data');
  }

  const key = Buffer.from(configured, 'base64');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  return key;
}

export function isSensitiveSessionKey(key: string): boolean {
  return key === 'stockbit_token' || key === 'stockbit_securities_token' || key === 'stockbit_securities_refresh_token';
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptSecret(value: string): string {
  // Backward compatibility lets an existing plaintext token be read once. The
  // next token refresh rewrites it encrypted.
  if (!value.startsWith(PREFIX)) return value;
  const [ivPart, tagPart, ciphertextPart] = value.slice(PREFIX.length).split('.');
  if (!ivPart || !tagPart || !ciphertextPart) throw new Error('Invalid encrypted secret format');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
