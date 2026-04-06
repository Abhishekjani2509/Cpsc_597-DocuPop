import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';

const {
  DATABASE_URL,
  PGHOST = 'localhost',
  PGPORT = '5432',
  PGUSER = 'docupop',
  PGPASSWORD = 'docupop',
  PGDATABASE = 'docupop',
} = process.env;

const poolConfig: PoolConfig = DATABASE_URL
  ? { connectionString: DATABASE_URL }
  : {
      host: PGHOST,
      port: Number(PGPORT),
      user: PGUSER,
      password: PGPASSWORD,
      database: PGDATABASE,
    };

const pool = new Pool(poolConfig);

export const db = {
  query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    return pool.query<T>(text, params);
  },
};

export async function initDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      content_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS documents_user_id_idx
    ON documents(user_id);
  `);

  // Create data_tables FIRST (before processing_jobs that references it)
  await db.query(`
    CREATE TABLE IF NOT EXISTS data_tables (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS data_fields (
      id UUID PRIMARY KEY,
      table_id UUID REFERENCES data_tables(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      data_type TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS data_rows (
      id UUID PRIMARY KEY,
      table_id UUID REFERENCES data_tables(id) ON DELETE CASCADE,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS data_field_mappings (
      id UUID PRIMARY KEY,
      table_id UUID REFERENCES data_tables(id) ON DELETE CASCADE,
      source_label TEXT NOT NULL,
      target_field TEXT NOT NULL,
      matcher TEXT NOT NULL DEFAULT 'contains',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Now create processing_jobs (which references data_tables)
  await db.query(`
    CREATE TABLE IF NOT EXISTS processing_jobs (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      engine TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      result JSONB,
      confidence NUMERIC,
      error TEXT,
      target_table_id UUID REFERENCES data_tables(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS processing_jobs_user_idx
    ON processing_jobs(user_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS processing_jobs_status_idx
    ON processing_jobs(status);
  `);

  await db.query(`
    ALTER TABLE processing_jobs
    ADD COLUMN IF NOT EXISTS target_table_id UUID REFERENCES data_tables(id) ON DELETE SET NULL;
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS processing_jobs_table_idx
    ON processing_jobs(target_table_id);
  `);

  await db.query(`
    ALTER TABLE data_rows
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS data_field_mappings_table_idx
    ON data_field_mappings(table_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS data_tables_user_idx ON data_tables(user_id);
  `);
}

