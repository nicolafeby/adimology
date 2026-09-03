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
    const requestOrigin = new URL(origin).origin;
    const allowedOrigins = new Set<string>([request.nextUrl.origin]);

    // Reverse proxies commonly expose an internal URL to Next.js. Reconstruct
    // the browser-facing origin from the standard forwarding headers.
    const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const host = forwardedHost ?? request.headers.get('host');
    if (host) {
      allowedOrigins.add(`${forwardedProto ?? request.nextUrl.protocol.slice(0, -1)}://${host}`);
    }

    const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (configuredSiteUrl) {
      allowedOrigins.add(new URL(configuredSiteUrl).origin);
    }

    return allowedOrigins.has(requestOrigin);
  } catch {
    return false;
  }
}
