import { NextRequest, NextResponse } from 'next/server';
import { refreshToken } from '@/server/auth/unified-auth';

export async function POST(request: NextRequest) {
  try {
    const { refreshToken: refreshTokenValue } = await request.json();

    if (!refreshTokenValue) {
      return NextResponse.json({ error: 'Refresh token is required' }, { status: 400 });
    }

    const result = await refreshToken(refreshTokenValue);

    return NextResponse.json({
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
    });
  } catch (error: any) {
    console.error('Token refresh error:', error);

    const message = error.message || 'Unable to refresh token';

    // If refresh token is invalid/expired, return 401 to trigger re-login
    if (message.includes('invalid') || message.includes('expired')) {
      return NextResponse.json({ error: message }, { status: 401 });
    }

    if (message.includes('not available')) {
      return NextResponse.json({ error: message }, { status: 501 });
    }

    return NextResponse.json({ error: 'Unable to refresh token' }, { status: 500 });
  }
}