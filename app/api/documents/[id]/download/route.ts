import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { getDocumentForUser, getStoredDocumentPath } from '@/server/data-store';
import { getSessionUserId } from '@/server/auth/session';

function parseDocumentId(value: string) {
  const id = Number(value);
  return Number.isFinite(id) ? id : null;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
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

  const filePath = getStoredDocumentPath(document);
  try {
    const fileBuffer = await fs.readFile(filePath);

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': document.content_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(document.filename)}"`,
        'Content-Length': fileBuffer.byteLength.toString(),
      },
    });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return NextResponse.json({ error: 'File missing on disk' }, { status: 404 });
    }
    console.error('Download error', error);
    return NextResponse.json({ error: 'Unable to download file' }, { status: 500 });
  }
}

