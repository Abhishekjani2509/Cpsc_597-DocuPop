import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/server/auth/session';
import { createFieldMapping, listFieldMappings } from '@/server/data-tables';

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = await context.params;
  try {
    const mappings = await listFieldMappings(params.id, userId);
    return NextResponse.json({ mappings });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unable to load mappings' }, { status: 400 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = await context.params;
  const body = await request.json();
  if (!body.sourceLabel || !body.targetField) {
    return NextResponse.json({ error: 'sourceLabel and targetField are required' }, { status: 400 });
  }

  try {
    const mapping = await createFieldMapping({
      tableId: params.id,
      userId,
      sourceLabel: body.sourceLabel,
      targetField: body.targetField,
      matcher: body.matcher,
    });
    return NextResponse.json({ mapping });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unable to create mapping' }, { status: 400 });
  }
}

