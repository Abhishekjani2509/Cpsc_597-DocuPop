import { NextResponse } from 'next/server';
import { claimNextPendingJob } from '@/server/processing-store';

function authorize(request: Request) {
  const configured = process.env.PROCESSING_WORKER_TOKEN;
  if (!configured) return false;
  const provided = request.headers.get('x-worker-token');
  return provided === configured;
}

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const job = await claimNextPendingJob();
  if (!job) {
    return NextResponse.json({ job: null });
  }

  return NextResponse.json({ job });
}

