import { NextRequest, NextResponse } from 'next/server';
import { forgotPassword } from '@/server/auth/unified-auth';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    await forgotPassword(email);

    // Always return success to prevent email enumeration
    return NextResponse.json({
      message: 'If an account exists with this email, a password reset code has been sent.',
    });
  } catch (error: any) {
    console.error('Forgot password error:', error);

    // Check if it's a rate limit error
    if (error.message?.includes('Too many attempts')) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }

    // Check if Cognito is not enabled
    if (error.message?.includes('not available')) {
      return NextResponse.json({ error: error.message }, { status: 501 });
    }

    // For other errors, still return success to prevent enumeration
    return NextResponse.json({
      message: 'If an account exists with this email, a password reset code has been sent.',
    });
  }
}
