import { NextRequest, NextResponse } from 'next/server';
import { verifyMfa } from '@/server/auth/unified-auth';

export async function POST(request: NextRequest) {
  try {
    const { session, mfaCode, email } = await request.json();

    if (!session || !mfaCode || !email) {
      return NextResponse.json(
        { error: 'Session, MFA code, and email are required' },
        { status: 400 }
      );
    }

    const result = await verifyMfa(session, mfaCode, email);

    return NextResponse.json({
      user: result.user,
      accessToken: result.token,
    });
  } catch (error: any) {
    console.error('MFA verification error:', error);
    const message = error.message || 'MFA verification failed';

    if (message.includes('Invalid MFA code')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (message.includes('expired')) {
      return NextResponse.json({ error: message }, { status: 401 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
