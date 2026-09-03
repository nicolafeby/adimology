import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT_PREFIX = 'scrypt';

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32);
  return `${SCRYPT_PREFIX}:${salt.toString('base64url')}:${derived.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, saltPart, hashPart] = stored.split(':');
  if (algorithm === SCRYPT_PREFIX && saltPart && hashPart) {
    const expected = Buffer.from(hashPart, 'base64url');
    const actual = scryptSync(password, Buffer.from(saltPart, 'base64url'), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  // Accept the previous unsalted SHA-256 format so users can log in and have it
  // transparently upgraded by the verification route.
  if (/^[a-f0-9]{64}$/i.test(stored)) {
    const actual = Buffer.from(createHash('sha256').update(password).digest('hex'));
    const expected = Buffer.from(stored.toLowerCase());
    return timingSafeEqual(actual, expected);
  }
  return false;
}

export function isLegacyPasswordHash(stored: string): boolean {
  return /^[a-f0-9]{64}$/i.test(stored);
}
