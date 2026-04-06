import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/server/auth/session';
import { listDocuments, saveDocument } from '@/server/data-store';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const documents = await listDocuments(userId);
  return NextResponse.json({ documents });
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'File is required' }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (!file.name) {
    return NextResponse.json({ error: 'Filename is missing' }, { status: 400 });
  }

  if (buffer.byteLength === 0) {
    return NextResponse.json({ error: 'File is empty' }, { status: 400 });
  }

  if (buffer.byteLength > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'File exceeds 10MB limit' }, { status: 400 });
  }

  const document = await saveDocument({
    userId,
    filename: file.name,
    buffer,
    contentType: file.type || 'application/octet-stream',
    size: buffer.byteLength,
  });

  return NextResponse.json({ document });
}

