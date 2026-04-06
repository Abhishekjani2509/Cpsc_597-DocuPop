import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/server/auth/session';
import { getProcessingJobForUser } from '@/server/processing-store';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = await context.params;
  const job = await getProcessingJobForUser(params.id, userId);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  return NextResponse.json({ job });
}

