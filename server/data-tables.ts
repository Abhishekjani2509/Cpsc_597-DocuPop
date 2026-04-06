import crypto from 'crypto';
import { db } from './db';

export const DOCUMENT_NAME_FIELD = 'DocumentName';

export interface DataTable {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  fields: DataField[];
  mappings?: DataFieldMapping[];
}

type DbTableRow = Omit<DataTable, 'fields'>;

async function ensureOwnedTable(tableId: string, userId: string): Promise<DataTable> {
  const table = await getTableById(tableId, userId);
  if (!table) {
    throw new Error('Table not found');
  }
  return table;
}

async function ensureFieldsExist(table: DataTable, fieldNames: string[]): Promise<DataTable> {
  const incoming = Array.from(new Set(fieldNames.filter(Boolean)));
  if (!incoming.includes(DOCUMENT_NAME_FIELD)) {
    incoming.unshift(DOCUMENT_NAME_FIELD);
  }
  if (!incoming.length) return table;

  const existing = new Set((table.fields || []).map((field) => field.name));
  const missing = incoming.filter((name) => !existing.has(name));
  if (!missing.length) return table;

  const basePosition = table.fields.length;
  const fieldValues = missing.map((name, idx) => [
    crypto.randomUUID(),
    table.id,
    name,
    'text',
    basePosition + idx,
  ]);
  const flat = fieldValues.flat();
  const placeholders = fieldValues
    .map((_, index) => {
      const offset = index * 5;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`;
    })
    .join(', ');
  await db.query(
    `
    INSERT INTO data_fields (id, table_id, name, data_type, position)
    VALUES ${placeholders};
  `,
    flat
  );

  const updated = await getTableById(table.id, table.user_id);
  if (!updated) {
    throw new Error('Table not found after update');
  }
  return updated;
}

export interface DataField {
  id: string;
  table_id: string;
  name: string;
  data_type: string;
  position: number;
}

export interface DataFieldMapping {
  id: string;
  table_id: string;
  source_label: string;
  target_field: string;
  matcher: string;
  created_at: string;
}

export interface DataRow {
  id: string;
  table_id: string;
  data: Record<string, any>;
  created_at: string;
}

export async function listTables(userId: string): Promise<DataTable[]> {
  const tables = await db.query<DbTableRow>(
    `
    SELECT id, user_id, name, description, created_at
    FROM data_tables
    WHERE user_id = $1
    ORDER BY created_at DESC;
  `,
    [userId]
  );

  if (tables.rowCount === 0) return [];

  const tableIds = tables.rows.map((table: DbTableRow) => table.id);
  const fields = await db.query<DataField>(
    `
    SELECT id, table_id, name, data_type, position
    FROM data_fields
    WHERE table_id = ANY($1::uuid[])
    ORDER BY position ASC;
  `,
    [tableIds]
  );

  const grouped = fields.rows.reduce<Record<string, DataField[]>>(
    (acc: Record<string, DataField[]>, field: DataField) => {
      acc[field.table_id] = acc[field.table_id] || [];
      acc[field.table_id].push(field);
      return acc;
    },
    {}
  );

  const tableRows: DbTableRow[] = tables.rows;
  const enrich = (table: DbTableRow): DataTable => ({
    ...table,
    fields: grouped[table.id] || [],
  });
  return tableRows.map(enrich);
}

export async function createTable(params: {
  userId: string;
  name: string;
  description?: string;
  fields: Array<{ name: string; data_type?: string }>;
}): Promise<DataTable> {
  const fieldSet = new Map<string, { name: string; data_type?: string }>();
  params.fields.forEach((field) => {
    if (field.name) {
      fieldSet.set(field.name, field);
    }
  });
  if (!fieldSet.has(DOCUMENT_NAME_FIELD)) {
    fieldSet.set(DOCUMENT_NAME_FIELD, { name: DOCUMENT_NAME_FIELD, data_type: 'text' });
  }
  const normalizedFields = Array.from(fieldSet.values());

  const tableId = crypto.randomUUID();
  await db.query(
    `
    INSERT INTO data_tables (id, user_id, name, description)
    VALUES ($1, $2, $3, $4);
  `,
    [tableId, params.userId, params.name, params.description || null]
  );

  const preparedFields = normalizedFields.map((field, index) => ({
    id: crypto.randomUUID(),
    table_id: tableId,
    name: field.name,
    data_type: field.data_type || 'text',
    position: index,
  }));

  if (preparedFields.length) {
    const flat = preparedFields.flatMap((f) => [f.id, f.table_id, f.name, f.data_type, f.position]);
    const placeholders = preparedFields
      .map((_, idx) => {
        const offset = idx * 5;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`;
      })
      .join(', ');

    await db.query(
      `
      INSERT INTO data_fields (id, table_id, name, data_type, position)
      VALUES ${placeholders};
    `,
      flat
    );
  }

  return getTableById(tableId, params.userId) as Promise<DataTable>;
}

export async function getTableById(id: string, userId: string, includeMappings = false): Promise<DataTable | null> {
  const table = await db.query<DataTable>(
    `
    SELECT id, user_id, name, description, created_at
    FROM data_tables
    WHERE id = $1 AND user_id = $2
    LIMIT 1;
  `,
    [id, userId]
  );

  if (table.rowCount === 0) return null;

  const fields = await db.query<DataField>(
    `
    SELECT id, table_id, name, data_type, position
    FROM data_fields
    WHERE table_id = $1
    ORDER BY position ASC;
  `,
    [id]
  );

  const base: DataTable = {
    ...table.rows[0],
    fields: fields.rows,
  };

  if (includeMappings) {
    const mappings = await db.query<DataFieldMapping>(
      `
      SELECT id, table_id, source_label, target_field, matcher, created_at
      FROM data_field_mappings
      WHERE table_id = $1
      ORDER BY created_at ASC;
    `,
      [id]
    );
    base.mappings = mappings.rows;
  }

  return base;
}

export async function deleteTable(id: string, userId: string): Promise<boolean> {
  const result = await db.query(
    `
    DELETE FROM data_tables
    WHERE id = $1 AND user_id = $2;
  `,
    [id, userId]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function updateTable(params: {
  tableId: string;
  userId: string;
  name?: string;
  description?: string | null;
}): Promise<DataTable | null> {
  const updates: string[] = [];
  const values: any[] = [];

  if (params.name) {
    values.push(params.name);
    updates.push(`name = $${values.length}`);
  }

  if (params.description !== undefined) {
    values.push(params.description);
    updates.push(`description = $${values.length}`);
  }

  if (!updates.length) {
    return getTableById(params.tableId, params.userId);
  }

  values.push(params.tableId, params.userId);
  updates.push(`updated_at = NOW()`);

  await db.query(
    `
    UPDATE data_tables
    SET ${updates.join(', ')}
    WHERE id = $${values.length - 1} AND user_id = $${values.length};
  `,
    values
  );

  return getTableById(params.tableId, params.userId);
}

export async function insertRows(params: {
  tableId: string;
  userId: string;
  rows: Record<string, any>[];
}): Promise<void> {
  let table = await ensureOwnedTable(params.tableId, params.userId);

  if (!params.rows.length) return;

  const incomingFields = Array.from(
    params.rows.reduce<Set<string>>((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>())
  );

  table = await ensureFieldsExist(table, incomingFields);

  const normalizedRows = params.rows.map((row) => ({
    id: crypto.randomUUID(),
    table_id: params.tableId,
    data: {
      ...row,
      [DOCUMENT_NAME_FIELD]: row[DOCUMENT_NAME_FIELD] ?? '',
    },
  }));

  const flat = normalizedRows.flatMap((r) => [r.id, r.table_id, JSON.stringify(r.data)]);
  const placeholders = normalizedRows
    .map((_, idx) => {
      const offset = idx * 3;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3})`;
    })
    .join(', ');

  await db.query(
    `
    INSERT INTO data_rows (id, table_id, data)
    VALUES ${placeholders};
  `,
    flat
  );
}

export async function listRows(params: { tableId: string; userId: string }): Promise<DataRow[]> {
  const table = await getTableById(params.tableId, params.userId);
  if (!table) {
    throw new Error('Table not found');
  }

  const result = await db.query<DataRow>(
    `
    SELECT id, table_id, data, created_at
    FROM data_rows
    WHERE table_id = $1
    ORDER BY created_at DESC
    LIMIT 100;
  `,
    [params.tableId]
  );

  return result.rows;
}

export async function updateRow(params: {
  tableId: string;
  rowId: string;
  userId: string;
  data: Record<string, any>;
}): Promise<DataRow | null> {
  const table = await ensureOwnedTable(params.tableId, params.userId);
  await ensureFieldsExist(table, Object.keys(params.data));

  const result = await db.query<DataRow>(
    `
    UPDATE data_rows
    SET data = $1::jsonb, updated_at = NOW()
    WHERE id = $2 AND table_id = $3
    RETURNING id, table_id, data, created_at, updated_at;
  `,
    [JSON.stringify(params.data), params.rowId, params.tableId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return result.rows[0];
}

export async function deleteRow(params: { tableId: string; rowId: string; userId: string }): Promise<boolean> {
  const table = await getTableById(params.tableId, params.userId);
  if (!table) {
    return false;
  }

  const result = await db.query(
    `
    DELETE FROM data_rows
    WHERE id = $1 AND table_id = $2;
  `,
    [params.rowId, params.tableId]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function listFieldMappings(tableId: string, userId: string): Promise<DataFieldMapping[]> {
  await ensureOwnedTable(tableId, userId);
  const result = await db.query<DataFieldMapping>(
    `
    SELECT id, table_id, source_label, target_field, matcher, created_at
    FROM data_field_mappings
    WHERE table_id = $1
    ORDER BY created_at ASC;
  `,
    [tableId]
  );
  return result.rows;
}

export async function createFieldMapping(params: {
  tableId: string;
  userId: string;
  sourceLabel: string;
  targetField: string;
  matcher?: string;
}): Promise<DataFieldMapping> {
  const table = await ensureOwnedTable(params.tableId, params.userId);
  await ensureFieldsExist(table, [params.targetField]);

  const result = await db.query<DataFieldMapping>(
    `
    INSERT INTO data_field_mappings (id, table_id, source_label, target_field, matcher)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, table_id, source_label, target_field, matcher, created_at;
  `,
    [
      crypto.randomUUID(),
      params.tableId,
      params.sourceLabel,
      params.targetField,
      params.matcher || 'contains',
    ]
  );

  return result.rows[0];
}

export async function deleteFieldMapping(params: {
  tableId: string;
  userId: string;
  mappingId: string;
}): Promise<boolean> {
  await ensureOwnedTable(params.tableId, params.userId);
  const result = await db.query(
    `
    DELETE FROM data_field_mappings
    WHERE id = $1 AND table_id = $2;
  `,
    [params.mappingId, params.tableId]
  );
  return (result.rowCount ?? 0) > 0;
}

