import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/server/auth/session';
import { deleteFieldMapping } from '@/server/data-tables';

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string; mappingId: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = await context.params;
  try {
    const removed = await deleteFieldMapping({
      tableId: params.id,
      userId,
      mappingId: params.mappingId,
    });
    if (!removed) {
      return NextResponse.json({ error: 'Mapping not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unable to delete mapping' }, { status: 400 });
  }
}

