import { NextRequest, NextResponse } from 'next/server';
import { confirmForgotPassword } from '@/server/auth/unified-auth';

export async function POST(request: NextRequest) {
  try {
    const { email, code, newPassword } = await request.json();

    if (!email || !code || !newPassword) {
      return NextResponse.json(
        { error: 'Email, verification code, and new password are required' },
        { status: 400 }
      );
    }

    await confirmForgotPassword(email, code, newPassword);

    return NextResponse.json({
      message: 'Password has been reset successfully. You can now sign in with your new password.',
    });
  } catch (error: any) {
    console.error('Reset password error:', error);

    const message = error.message || 'Unable to reset password';

    // Map specific error messages to appropriate status codes
    if (message.includes('Invalid verification code')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (message.includes('expired')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (message.includes('Password does not meet requirements')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (message.includes('not available')) {
      return NextResponse.json({ error: message }, { status: 501 });
    }

    return NextResponse.json({ error: 'Unable to reset password' }, { status: 500 });
  }
}