import { NextRequest, NextResponse } from 'next/server';
import { signUp } from '@/server/auth/unified-auth';
import { applySessionCookie, createSessionToken } from '@/server/auth/session';
import { config } from '@/server/config';

export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json();

    if (!email || !password || !name) {
      return NextResponse.json({ error: 'Name, email, and password are required' }, { status: 400 });
    }

    const result = await signUp(email, password, name);

    if (config.cognito.enabled) {
      // For Cognito, user needs to confirm email before signing in
      return NextResponse.json({
        user: result.user,
        confirmationRequired: true,
        message: 'Please check your email for a confirmation code.',
      });
    } else {
      // For local auth, auto sign in with session cookie
      const sessionToken = createSessionToken(result.user.id);
      const response = NextResponse.json({ user: result.user });
      applySessionCookie(response, sessionToken);
      return response;
    }
  } catch (error: any) {
    console.error('Signup error', error);
    const message = error.message || 'Unable to create account';

    // Map specific errors to appropriate status codes
    if (message.includes('already registered') || message.includes('already')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (message.includes('Password does not meet')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

