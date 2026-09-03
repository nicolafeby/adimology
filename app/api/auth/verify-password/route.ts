import { NextRequest, NextResponse } from 'next/server';
import { getProfileSetting } from '@/lib/supabase';
import { setProfileSetting } from '@/lib/supabase';
import { setSession } from '@/lib/auth';
import { hashPassword, isLegacyPasswordHash, verifyPassword } from '@/lib/password';
import { isSameOrigin } from '@/lib/request-security';

export async function POST(request: NextRequest) {
  try {
    if (!isSameOrigin(request)) {
      return NextResponse.json({ success: false, error: 'Invalid origin' }, { status: 403 });
    }
    const body = await request.json();
    const { password } = body;

    if (!password) {
      return NextResponse.json(
        { success: false, error: 'Password is required' },
        { status: 400 }
      );
    }

    const storedHash = await getProfileSetting('password_hash');

    if (!storedHash) {
      return NextResponse.json(
        { success: false, error: 'No password has been set' },
        { status: 400 }
      );
    }

    const valid = verifyPassword(password, storedHash);

    if (valid) {
      if (isLegacyPasswordHash(storedHash)) {
        await setProfileSetting('password_hash', hashPassword(password));
      }
      const response = NextResponse.json({ success: true, valid: true });
      await setSession(response);
      return response;
    }

    return NextResponse.json({ success: true, valid: false });
  } catch (error) {
    console.error('Error verifying password:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
