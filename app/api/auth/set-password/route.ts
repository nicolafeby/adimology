import { NextRequest, NextResponse } from 'next/server';
import { setProfileSetting } from '@/lib/supabase';
import { clearSession, getSession } from '@/lib/auth';
import { getProfileSetting } from '@/lib/supabase';
import { hashPassword } from '@/lib/password';
import { isSameOrigin } from '@/lib/request-security';

export async function POST(request: NextRequest) {
  try {
    if (!isSameOrigin(request)) {
      return NextResponse.json({ success: false, error: 'Invalid origin' }, { status: 403 });
    }
    const existingHash = await getProfileSetting('password_hash');
    if (existingHash) {
      const session = await getSession(request);
      if (!session?.verified) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
    }
    const body = await request.json();
    const { password, enabled } = body;

    if (enabled && (!password || password.length < 12)) {
      return NextResponse.json(
        { success: false, error: 'Password minimal 12 karakter' },
        { status: 400 }
      );
    }

    if (enabled) {
      const hash = hashPassword(password);
      await setProfileSetting('password_hash', hash);
      await setProfileSetting('password_enabled', 'true');
    } else {
      await setProfileSetting('password_hash', '');
      await setProfileSetting('password_enabled', 'false');
    }

    const response = NextResponse.json({ success: true });
    await clearSession(response);
    return response;
  } catch (error) {
    console.error('Error setting password:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
