import { NextRequest, NextResponse } from 'next/server';
import { getUserById, sanitizeUser } from '@/server/data-store';
import { getSessionUserId } from '@/server/auth/session';
import { verifyAuth } from '@/server/auth/unified-auth';
import { config } from '@/server/config';

export async function GET(request: NextRequest) {
  try {
    if (config.cognito.enabled) {
      // For Cognito, verify the Bearer token
      const authHeader = request.headers.get('authorization');
      const token = authHeader?.replace('Bearer ', '');

      if (!token) {
        return NextResponse.json({ user: null }, { status: 401 });
      }

      const user = await verifyAuth(token);
      if (!user) {
        return NextResponse.json({ user: null }, { status: 401 });
      }

      return NextResponse.json({ user });
    } else {
      // For local auth, use session cookies
      const userId = await getSessionUserId();
      if (!userId) {
        return NextResponse.json({ user: null }, { status: 401 });
      }

      const user = await getUserById(userId);
      if (!user) {
        return NextResponse.json({ user: null }, { status: 401 });
      }

      return NextResponse.json({ user: sanitizeUser(user) });
    }
  } catch (error) {
    console.error('Auth check error:', error);
    return NextResponse.json({ user: null }, { status: 401 });
  }
}

