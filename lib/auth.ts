import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const SESSION_NAME = 'adimology_session';
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Use AUTH_SECRET from env or fallback for dev (Warning during production)
function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET must be configured with at least 32 characters');
  }
  return secret;
}

/**
 * Basic HMAC-based token signing using Web Crypto API
 * Works in both Node.js and Edge Runtime (Middleware)
 */
async function getCryptoKey() {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(getAuthSecret());
  return await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function createSessionToken(payload: any): Promise<string> {
  const key = await getCryptoKey();
  const encoder = new TextEncoder();
  
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify({
    ...payload,
    exp: Date.now() + SESSION_DURATION
  }));
  
  const data = encoder.encode(`${header}.${body}`);
  const signature = await crypto.subtle.sign('HMAC', key, data);
  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
    
  return `${header}.${body}.${signatureBase64}`;
}

export async function verifySessionToken(token: string): Promise<any | null> {
  try {
    const [header, body, signature] = token.split('.');
    if (!header || !body || !signature) return null;

    const key = await getCryptoKey();
    const encoder = new TextEncoder();
    const data = encoder.encode(`${header}.${body}`);

    // Convert base64url back to original base64
    const signatureBase64 = signature.replace(/-/g, '+').replace(/_/g, '/');
    const signatureBin = atob(signatureBase64);
    const signatureUint8 = new Uint8Array(signatureBin.length);
    for (let i = 0; i < signatureBin.length; i++) {
      signatureUint8[i] = signatureBin.charCodeAt(i);
    }

    const isValid = await crypto.subtle.verify('HMAC', key, signatureUint8, data);
    if (!isValid) return null;

    const payload = JSON.parse(atob(body));
    if (payload.exp < Date.now()) return null;

    return payload;
  } catch (error) {
    return null;
  }
}

/**
 * Set session cookie in Response
 */
export async function setSession(response: NextResponse, verified: boolean = true) {
  const token = await createSessionToken({ authenticated: true, verified });
  
  response.cookies.set(SESSION_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24, // 24 hours
  });
  
  return response;
}

/**
 * Check if the request has a valid session
 */
export async function getSession(req: NextRequest | Request) {
  const cookieStore = cookies();
  const token = (await cookieStore).get(SESSION_NAME)?.value;
  
  if (!token) return null;
  return await verifySessionToken(token);
}

/**
 * Clear session cookie
 */
export async function clearSession(response: NextResponse) {
  response.cookies.set(SESSION_NAME, '', {
    httpOnly: true,
    expires: new Date(0),
    path: '/',
  });
  return response;
}
