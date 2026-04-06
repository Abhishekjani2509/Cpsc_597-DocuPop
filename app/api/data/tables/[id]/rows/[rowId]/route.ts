import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/server/auth/session';
import { deleteRow, updateRow } from '@/server/data-tables';

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string; rowId: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = await context.params;
  const body = await request.json();
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const updated = await updateRow({
    tableId: params.id,
    rowId: params.rowId,
    userId,
    data: body,
  });

  if (!updated) {
    return NextResponse.json({ error: 'Row not found' }, { status: 404 });
  }

  return NextResponse.json({ row: updated });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string; rowId: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = await context.params;
  const removed = await deleteRow({
    tableId: params.id,
    rowId: params.rowId,
    userId,
  });

  if (!removed) {
    return NextResponse.json({ error: 'Row not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

