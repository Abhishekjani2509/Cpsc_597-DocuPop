import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import crypto from 'crypto';

const SESSION_COOKIE_NAME = 'docupop_local_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const SECRET = process.env.LOCAL_AUTH_SECRET || 'docupop-local-secret';

interface SessionPayload {
  userId: string;
  exp: number;
}

function encodePayload(payload: SessionPayload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodePayload(value: string): SessionPayload {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf-8'));
}

function signPayload(payload: string) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

function verifyToken(token: string): SessionPayload | null {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(provided, expected)) {
    return null;
  }

  const payload = decodePayload(encodedPayload);
  if (Date.now() > payload.exp) {
    return null;
  }

  return payload;
}

export function createSessionToken(userId: string) {
  const payload: SessionPayload = {
    userId,
    exp: Date.now() + SESSION_TTL_SECONDS * 1000,
  };

  const encodedPayload = encodePayload(payload);
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function applySessionCookie(response: NextResponse, token: string) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

export async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  const payload = verifyToken(token);
  return payload?.userId ?? null;
}

