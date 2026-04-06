import { NextRequest, NextResponse } from 'next/server';
import { deleteDocument, getDocumentForUser, toPublicDocument } from '@/server/data-store';
import { getSessionUserId } from '@/server/auth/session';

function parseDocumentId(value: string) {
  const id = Number(value);
  return Number.isFinite(id) ? id : null;
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = await context.params;
  const id = parseDocumentId(params.id);
  if (id === null) {
    return NextResponse.json({ error: 'Invalid document id' }, { status: 400 });
  }

  const document = await getDocumentForUser(id, userId);
  if (!document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  return NextResponse.json({ document: toPublicDocument(document) });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = await context.params;
  const id = parseDocumentId(params.id);
  if (id === null) {
    return NextResponse.json({ error: 'Invalid document id' }, { status: 400 });
  }

  const removed = await deleteDocument(id, userId);
  if (!removed) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

