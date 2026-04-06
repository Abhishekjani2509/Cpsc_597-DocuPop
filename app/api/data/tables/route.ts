import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/server/auth/session';
import { listTables, createTable } from '@/server/data-tables';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tables = await listTables(userId);
  return NextResponse.json({ tables });
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  if (!body.name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const fields = Array.isArray(body.fields)
    ? body.fields.filter((field: any) => field?.name).map((field: any) => ({
        name: field.name,
        data_type: field.data_type || 'text',
      }))
    : [];

  try {
    const table = await createTable({
      userId,
      name: body.name,
      description: body.description,
      fields,
    });
    return NextResponse.json({ table });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unable to create table' }, { status: 400 });
  }
}

