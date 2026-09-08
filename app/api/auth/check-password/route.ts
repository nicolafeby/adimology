import { NextResponse } from 'next/server';
import { getProfileSetting } from '@/lib/supabase';
import { verifySessionToken, setSession, sessionTokenFromRequest } from '@/lib/auth';
import { AUTH_SETTINGS_TIMEOUT_MS } from '@/lib/auth-timeouts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const signal = AbortSignal.timeout(AUTH_SETTINGS_TIMEOUT_MS);
  try {
    const [enabledSetting, hash] = await Promise.all([
      getProfileSetting('password_enabled', true, signal),
      getProfileSetting('password_hash', true, signal),
    ]);
    if (!['true','false'].includes(enabledSetting ?? '')) throw new Error('Pengaturan keamanan tidak valid.');
    const isEnabled = enabledSetting === 'true';

    // Also check if valid session exists
    const sessionCookie = sessionTokenFromRequest(request);

    let isAuthenticated = false;
    if (sessionCookie) {
      const session = await verifySessionToken(sessionCookie);
      if (session) {
        // If password is enabled, we require a verified session (from password entry)
        // If password is disabled, any valid session is fine
        if (isEnabled) {
          isAuthenticated = session.verified === true;
        } else {
          isAuthenticated = true;
        }
      }
    }

    // Prepare response
    const result = {
      success: true,
      enabled: isEnabled,
      hasPassword: !!hash && hash.length > 0,
      isAuthenticated,
    };

    // IF password gate is disabled, automatically issue a guest session cookie
    // so subsequent API calls pass the proxy
    if (!isEnabled) {
      const response = NextResponse.json({ ...result, isAuthenticated: true });
      await setSession(response, false);
      return response;
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { success: false, code: signal.aborted ? 'AUTH_SETTINGS_TIMEOUT' : 'AUTH_SETTINGS_UNAVAILABLE', error: signal.aborted ? 'Layanan pengaturan login belum merespons. Coba lagi setelah koneksi layanan pulih.' : 'Status keamanan tidak dapat diverifikasi. Coba lagi.' },
      { status: 503 }
    );
  }
}
