import { NextRequest, NextResponse } from 'next/server';
import { getMfaSecret, completeMfaSetup } from '@/server/auth/unified-auth';

/**
 * GET: Get TOTP secret for MFA setup
 * Returns the secret code to display as QR code or manual entry
 */
export async function GET(request: NextRequest) {
  try {
    const session = request.nextUrl.searchParams.get('session');

    if (!session) {
      return NextResponse.json({ error: 'Session is required' }, { status: 400 });
    }

    const result = await getMfaSecret(session);

    // Generate otpauth URI for QR code
    const issuer = 'DocuPop';
    const otpauthUri = `otpauth://totp/${issuer}?secret=${result.secretCode}&issuer=${issuer}`;

    return NextResponse.json({
      secretCode: result.secretCode,
      session: result.session,
      otpauthUri,
    });
  } catch (error: any) {
    console.error('MFA setup error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get MFA setup secret' },
      { status: 500 }
    );
  }
}

/**
 * POST: Complete MFA setup by verifying the first TOTP code
 */
export async function POST(request: NextRequest) {
  try {
    const { session, mfaCode, email } = await request.json();

    if (!session || !mfaCode || !email) {
      return NextResponse.json(
        { error: 'Session, MFA code, and email are required' },
        { status: 400 }
      );
    }

    const result = await completeMfaSetup(session, mfaCode, email);

    return NextResponse.json({
      user: result.user,
      accessToken: result.token,
      message: 'MFA setup completed successfully',
    });
  } catch (error: any) {
    console.error('MFA setup completion error:', error);
    const message = error.message || 'MFA setup failed';

    if (message.includes('Invalid MFA code')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
