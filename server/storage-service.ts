/**
 * Storage Service
 *
 * Abstraction layer for file storage that supports both:
 * - Local filesystem (for development)
 * - AWS S3 (for staging/production)
 *
 * Security features:
 * - Environment-based storage selection
 * - Presigned URLs for secure S3 access
 * - No hardcoded credentials (uses IAM roles or env vars)
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { promises as fs } from 'fs';
import path from 'path';
import { config } from './config';

// S3 Client (only initialized if S3 is enabled)
let s3Client: S3Client | null = null;

if (config.s3.enabled) {
  s3Client = new S3Client({
    region: config.s3.region,
    // Credentials are automatically loaded from:
    // 1. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
    // 2. IAM roles (when running on AWS - Amplify, Lambda, ECS)
    // 3. AWS credentials file (~/.aws/credentials)
  });
  console.log(`✅ S3 client initialized for bucket: ${config.s3.bucketName}`);
}

// Local storage directory (used when S3 is disabled)
const LOCAL_UPLOAD_DIR = path.join(process.cwd(), 'local-data', 'uploads');

/**
 * Initialize local storage directory
 */
async function ensureLocalDirectory() {
  if (!config.s3.enabled) {
    await fs.mkdir(LOCAL_UPLOAD_DIR, { recursive: true });
  }
}

// Initialize on module load
ensureLocalDirectory().catch(console.error);

/**
 * Generate a unique storage key for a file
 */
function generateStorageKey(originalFilename: string): string {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 15);
  const ext = path.extname(originalFilename);
  const basename = path.basename(originalFilename, ext);

  // Sanitize filename
  const sanitized = basename.replace(/[^a-zA-Z0-9-_]/g, '_');

  return `uploads/${timestamp}-${randomId}-${sanitized}${ext}`;
}

/**
 * Save a file to storage (S3 or local filesystem)
 */
export async function saveFile(
  filename: string,
  buffer: Buffer,
  contentType?: string
): Promise<string> {
  const storageKey = generateStorageKey(filename);

  if (config.s3.enabled && s3Client) {
    // Save to S3
    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.s3.bucketName!,
        Key: storageKey,
        Body: buffer,
        ContentType: contentType || 'application/octet-stream',
        ServerSideEncryption: 'AES256',
      })
    );
    return storageKey;
  } else {
    // Save to local filesystem
    const localPath = path.join(LOCAL_UPLOAD_DIR, path.basename(storageKey));
    await fs.writeFile(localPath, buffer);
    return path.basename(storageKey);
  }
}

/**
 * Get a file from storage
 */
export async function getFile(storageKey: string): Promise<Buffer> {
  if (config.s3.enabled && s3Client && storageKey.startsWith('uploads/')) {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: config.s3.bucketName!,
        Key: storageKey,
      })
    );
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as any) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } else {
    const localPath = path.join(LOCAL_UPLOAD_DIR, path.basename(storageKey));
    return fs.readFile(localPath);
  }
}

/**
 * Delete a file from storage
 */
export async function deleteFile(storageKey: string): Promise<void> {
  if (config.s3.enabled && s3Client && storageKey.startsWith('uploads/')) {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: config.s3.bucketName!,
        Key: storageKey,
      })
    );
  } else {
    const localPath = path.join(LOCAL_UPLOAD_DIR, path.basename(storageKey));
    await fs.unlink(localPath).catch(() => {});
  }
}

/**
 * Get a download URL for a file
 */
export async function getDownloadUrl(
  storageKey: string,
  expiresIn: number = 3600
): Promise<string> {
  if (config.s3.enabled && s3Client && storageKey.startsWith('uploads/')) {
    const command = new GetObjectCommand({
      Bucket: config.s3.bucketName!,
      Key: storageKey,
    });
    return getSignedUrl(s3Client, command, { expiresIn });
  } else {
    return `/api/documents/${storageKey}/download`;
  }
}

/**
 * Get local file path (for compatibility)
 */
export function getLocalFilePath(storageKey: string): string {
  if (config.s3.enabled) {
    throw new Error('Local file path not available when S3 is enabled');
  }
  return path.join(LOCAL_UPLOAD_DIR, path.basename(storageKey));
}