import { NextRequest, NextResponse } from 'next/server';
import { createUser, sanitizeUser } from '@/server/data-store';
import { applySessionCookie, createSessionToken } from '@/server/auth/session';

export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json();

    if (!email || !password || !name) {
      return NextResponse.json({ error: 'Name, email, and password are required' }, { status: 400 });
    }

    const user = await createUser({ email, password, name });
    const token = createSessionToken(user.id);
    const response = NextResponse.json({ user: sanitizeUser(user) });
    applySessionCookie(response, token);
    return response;
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Unable to create account';
    const status = message.includes('already') ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

