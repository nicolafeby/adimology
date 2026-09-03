import { timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';

export function secretsEqual(actual: string | null, expected: string | undefined): boolean {
  if (!actual || !expected) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // Non-browser clients and same-origin GET-style tooling.
  try {
    return new URL(origin).host === request.nextUrl.host;
  } catch {
    return false;
  }
}
