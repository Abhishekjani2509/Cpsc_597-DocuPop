import { NextRequest, NextResponse } from 'next/server';
import { signIn } from '@/server/auth/unified-auth';
import { applySessionCookie, createSessionToken } from '@/server/auth/session';
import { config } from '@/server/config';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const result = await signIn(email, password);

    // Check if MFA is required
    if (result.mfaRequired) {
      return NextResponse.json({
        mfaRequired: true,
        session: result.session,
        email: email.toLowerCase(),
      });
    }

    // Check if MFA setup is required (first-time user)
    if (result.mfaSetupRequired) {
      return NextResponse.json({
        mfaSetupRequired: true,
        session: result.session,
        email: email.toLowerCase(),
      });
    }

    if (config.cognito.enabled) {
      // For Cognito, return the access token for client-side storage
      return NextResponse.json({
        user: result.user,
        accessToken: result.token,
      });
    } else {
      // For local auth, use session cookies
      if (!result.user) {
        return NextResponse.json({ error: 'Authentication failed' }, { status: 401 });
      }
      const sessionToken = createSessionToken(result.user.id);
      const response = NextResponse.json({ user: result.user });
      applySessionCookie(response, sessionToken);
      return response;
    }
  } catch (error: any) {
    console.error('Login error', error);
    const message = error.message || 'Unable to sign in right now';

    // Map specific errors to appropriate status codes
    if (message.includes('Invalid email or password')) {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    if (message.includes('not confirmed')) {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

