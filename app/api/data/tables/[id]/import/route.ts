import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/server/auth/session';
import { getTableById, insertRows } from '@/server/data-tables';
import { parse } from 'csv-parse/sync';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = await context.params;
  const table = await getTableById(params.id, userId);
  if (!table) {
    return NextResponse.json({ error: 'Table not found' }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const records: string[][] = parse(buffer, { skip_empty_lines: true });
    if (!records.length) {
      return NextResponse.json({ error: 'CSV is empty' }, { status: 400 });
    }

    const headers = records[0];
    const rows = records.slice(1).map((row) => {
      return headers.reduce<Record<string, any>>((acc, header, idx) => {
        acc[header] = row[idx] ?? null;
        return acc;
      }, {});
    });

    await insertRows({ tableId: table.id, userId, rows });
    return NextResponse.json({ inserted: rows.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unable to parse CSV' }, { status: 400 });
  }
}

