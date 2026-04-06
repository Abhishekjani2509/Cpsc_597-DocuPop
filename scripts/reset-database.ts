import { Pool } from 'pg';

async function resetDatabase() {
  // Database credentials from environment variables
  const host = process.env.PGHOST;
  const port = parseInt(process.env.PGPORT || '5432', 10);
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;
  const database = process.env.PGDATABASE || 'postgres';

  if (!host || !user || !password) {
    console.error('[ERROR] Missing required environment variables: PGHOST, PGUSER, PGPASSWORD');
    console.error('Set these environment variables before running this script.');
    process.exit(1);
  }

  const pool = new Pool({
    host,
    port,
    user,
    password,
    database,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('[INFO] Connecting to Aurora database...');

    // Get list of all tables
    const tablesResult = await pool.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public';
    `);

    console.log(`[INFO] Found ${tablesResult.rows.length} tables to drop:`, tablesResult.rows.map(r => r.tablename));

    // Drop all tables
    for (const row of tablesResult.rows) {
      const tableName = row.tablename;
      console.log(`[INFO] Dropping table: ${tableName}`);
      await pool.query(`DROP TABLE IF EXISTS "${tableName}" CASCADE;`);
    }

    console.log('[INFO] All tables dropped');
    console.log('');
    console.log('[INFO] Creating fresh schema...');

    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('[INFO] Created: users');

    // Create documents table
    await pool.query(`
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
    console.log('[INFO] Created: documents');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS documents_user_id_idx
      ON documents(user_id);
    `);
    console.log('[INFO] Created index: documents_user_id_idx');

    // Create data_tables table (before processing_jobs that references it)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS data_tables (
        id UUID PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('[INFO] Created: data_tables');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS data_fields (
        id UUID PRIMARY KEY,
        table_id UUID REFERENCES data_tables(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        data_type TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0
      );
    `);
    console.log('[INFO] Created: data_fields');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS data_rows (
        id UUID PRIMARY KEY,
        table_id UUID REFERENCES data_tables(id) ON DELETE CASCADE,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('[INFO] Created: data_rows');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS data_field_mappings (
        id UUID PRIMARY KEY,
        table_id UUID REFERENCES data_tables(id) ON DELETE CASCADE,
        source_label TEXT NOT NULL,
        target_field TEXT NOT NULL,
        matcher TEXT NOT NULL DEFAULT 'contains',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('[INFO] Created: data_field_mappings');

    // Create processing_jobs table (references data_tables)
    await pool.query(`
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
    console.log('[INFO] Created: processing_jobs');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS processing_jobs_user_idx
      ON processing_jobs(user_id);
    `);
    console.log('[INFO] Created index: processing_jobs_user_idx');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS processing_jobs_status_idx
      ON processing_jobs(status);
    `);
    console.log('[INFO] Created index: processing_jobs_status_idx');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS processing_jobs_table_idx
      ON processing_jobs(target_table_id);
    `);
    console.log('[INFO] Created index: processing_jobs_table_idx');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS data_field_mappings_table_idx
      ON data_field_mappings(table_id);
    `);
    console.log('[INFO] Created index: data_field_mappings_table_idx');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS data_tables_user_idx
      ON data_tables(user_id);
    `);
    console.log('[INFO] Created index: data_tables_user_idx');

    console.log('');
    console.log('[INFO] Database reset complete!');
    console.log('[INFO] Fresh schema created with all tables and indexes');

  } catch (error) {
    console.error('[ERROR] Error resetting database:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

resetDatabase().catch(console.error);
