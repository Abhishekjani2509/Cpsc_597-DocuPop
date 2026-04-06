import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db, initDatabase } from './db';
import * as storageService from './storage-service';
import { config } from './config';

const DATA_DIR = path.join(process.cwd(), 'local-data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DEFAULT_USER_PASSWORD = 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f';
const DEMO_USER_ID = '11111111-1111-1111-1111-111111111111';

export interface DocumentRecord {
  id: number;
  userId: string;
  filename: string;
  storedFilename: string;
  file_size: number;
  content_type: string;
  created_at: string;
}

export interface PublicDocument {
  id: number;
  filename: string;
  file_size: number;
  content_type: string;
  created_at: string;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
}

async function ensureFilesystem() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

async function seedDemoUser() {
  await db.query(
    `
    INSERT INTO users (id, email, name, password_hash)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (email) DO NOTHING;
  `,
    [DEMO_USER_ID, 'demo@docupop.local', 'Demo User', DEFAULT_USER_PASSWORD]
  );
}

async function ensureDocumentsHaveOwners() {
  await db.query(
    `
    UPDATE documents
    SET user_id = $1
    WHERE user_id IS NULL;
  `,
    [DEMO_USER_ID]
  );
}

const initializationPromise = (async () => {
  // Only create local directories if not using S3
  if (!config.s3.enabled) {
    await ensureFilesystem();
  }
  await initDatabase();
  await seedDemoUser();
  await ensureDocumentsHaveOwners();
})();

async function ensureInitialized() {
  await initializationPromise;
}

export function hashPassword(password: string) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export async function listDocuments(userId: string): Promise<PublicDocument[]> {
  await ensureInitialized();
  const result = await db.query<DocumentRecord & { stored_filename: string }>(
    `
    SELECT id, user_id, filename, stored_filename, file_size, content_type, created_at
    FROM documents
    WHERE user_id = $1
    ORDER BY created_at DESC;
  `,
    [userId]
  );

  return result.rows.map(fromRow).map(toPublicDocument);
}

export async function saveDocument(params: {
  userId: string;
  filename: string;
  buffer: Buffer;
  contentType: string;
  size: number;
}): Promise<PublicDocument> {
  await ensureInitialized();

  // Use storage service (S3 or local filesystem based on environment)
  const storageKey = await storageService.saveFile(
    params.filename,
    params.buffer,
    params.contentType
  );

  const result = await db.query<DocumentRecord & { stored_filename: string }>(
    `
    INSERT INTO documents (user_id, filename, stored_filename, file_size, content_type)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, user_id, filename, stored_filename, file_size, content_type, created_at;
  `,
    [params.userId, params.filename, storageKey, params.size, params.contentType || 'application/octet-stream']
  );

  const record = fromRow(result.rows[0]);
  return toPublicDocument(record);
}

export async function getDocumentForUser(id: number, userId: string): Promise<DocumentRecord | null> {
  await ensureInitialized();
  const result = await db.query<DocumentRecord & { stored_filename: string }>(
    `
    SELECT id, user_id, filename, stored_filename, file_size, content_type, created_at
    FROM documents
    WHERE id = $1 AND user_id = $2;
  `,
    [id, userId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return fromRow(result.rows[0]);
}

export async function deleteDocument(id: number, userId: string): Promise<boolean> {
  await ensureInitialized();
  const result = await db.query<{ stored_filename: string }>(
    `
    DELETE FROM documents
    WHERE id = $1 AND user_id = $2
    RETURNING stored_filename;
  `,
    [id, userId]
  );

  if (result.rowCount === 0) {
    return false;
  }

  const storageKey = result.rows[0].stored_filename;

  // Use storage service to delete file (S3 or local filesystem)
  await storageService.deleteFile(storageKey);

  return true;
}

export function toPublicDocument(doc: DocumentRecord): PublicDocument {
  const { storedFilename, userId, ...rest } = doc;
  return rest;
}

export function getStoredDocumentPath(doc: DocumentRecord) {
  // For backward compatibility with OCR worker
  // Returns local path for local env, or uses storage service for S3
  if (config.s3.enabled) {
    // S3 is enabled - return the storage key directly
    // The OCR worker will need to download from S3
    return doc.storedFilename;
  } else {
    // Local filesystem - return full path
    return storageService.getLocalFilePath(doc.storedFilename);
  }
}

export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  await ensureInitialized();
  const result = await db.query<UserRecord & { password_hash: string }>(
    `
    SELECT id, email, name, password_hash
    FROM users
    WHERE LOWER(email) = LOWER($1)
    LIMIT 1;
  `,
    [email]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return {
    id: result.rows[0].id,
    email: result.rows[0].email,
    name: result.rows[0].name,
    passwordHash: result.rows[0].password_hash,
  };
}

export async function getUserById(id: string): Promise<UserRecord | null> {
  await ensureInitialized();
  const result = await db.query<UserRecord & { password_hash: string }>(
    `
    SELECT id, email, name, password_hash
    FROM users
    WHERE id = $1
    LIMIT 1;
  `,
    [id]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return {
    id: result.rows[0].id,
    email: result.rows[0].email,
    name: result.rows[0].name,
    passwordHash: result.rows[0].password_hash,
  };
}

export async function createUser(params: { email: string; password: string; name: string }): Promise<UserRecord> {
  await ensureInitialized();
  const passwordHash = hashPassword(params.password);
  const userId = crypto.randomUUID();

  try {
    const result = await db.query<UserRecord & { password_hash: string }>(
      `
      INSERT INTO users (id, email, name, password_hash)
      VALUES ($1, LOWER($2), $3, $4)
      RETURNING id, email, name, password_hash;
    `,
      [userId, params.email, params.name, passwordHash]
    );

    return {
      id: result.rows[0].id,
      email: result.rows[0].email,
      name: result.rows[0].name,
      passwordHash: result.rows[0].password_hash,
    };
  } catch (error: any) {
    if (error.code === '23505') {
    throw new Error('Email is already registered');
  }
    throw error;
  }
}

export async function verifyCredentials(email: string, password: string): Promise<UserRecord | null> {
  const user = await getUserByEmail(email);
  if (!user) {
    return null;
  }

  return user.passwordHash === hashPassword(password) ? user : null;
}

export function sanitizeUser(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}

function fromRow(row: any): DocumentRecord {
  return {
    id: row.id,
    userId: row.user_id,
    filename: row.filename,
    storedFilename: row.stored_filename,
    file_size: row.file_size,
    content_type: row.content_type,
    created_at: row.created_at,
  };
}

