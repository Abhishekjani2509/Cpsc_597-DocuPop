import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/server/auth/session';
import { createProcessingJobs, listProcessingJobs } from '@/server/processing-store';
import { getTableById } from '@/server/data-tables';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const jobs = await listProcessingJobs(userId);
  return NextResponse.json({ jobs });
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const documentIds: number[] = Array.isArray(body.documentIds) ? body.documentIds : [];
  if (documentIds.length === 0) {
    return NextResponse.json({ error: 'documentIds required' }, { status: 400 });
  }

  const targetTableId = body.targetTableId || null;
  if (targetTableId) {
    const table = await getTableById(targetTableId, userId);
    if (!table) {
      return NextResponse.json({ error: 'Target table not found' }, { status: 404 });
    }
  }

  try {
    const jobs = await createProcessingJobs({
      userId,
      documentIds,
      engine: body.engine,
      targetTableId,
    });

    return NextResponse.json({ jobs });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unable to create job' }, { status: 400 });
  }
}

