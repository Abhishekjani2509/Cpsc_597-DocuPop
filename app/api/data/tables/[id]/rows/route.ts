import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/server/auth/session';
import { insertRows, listRows } from '@/server/data-tables';

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = await context.params;
  try {
    const rows = await listRows({ tableId: params.id, userId });
    return NextResponse.json({ rows });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unable to list rows' }, { status: 400 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = await context.params;
  const body = await request.json();
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) {
    return NextResponse.json({ error: 'rows array required' }, { status: 400 });
  }

  try {
    await insertRows({ tableId: params.id, userId, rows });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unable to insert rows' }, { status: 400 });
  }
}

