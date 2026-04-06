import { NextRequest, NextResponse } from 'next/server';
import { completeJob, failJob } from '@/server/processing-store';

function authorize(request: Request) {
  const configured = process.env.PROCESSING_WORKER_TOKEN;
  if (!configured) return false;
  const provided = request.headers.get('x-worker-token');
  return provided === configured;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = await context.params;
  const { status, result, confidence, error } = await request.json();
  if (status === 'completed') {
    await completeJob({
      jobId: params.id,
      result: result ?? {},
      confidence,
    });
    return NextResponse.json({ success: true });
  }

  if (status === 'failed') {
    await failJob(params.id, error || 'Worker failure');
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unsupported status' }, { status: 400 });
}

