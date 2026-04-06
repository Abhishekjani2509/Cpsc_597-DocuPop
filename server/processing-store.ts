import crypto from 'crypto';
import { db } from './db';
import { DocumentRecord, getStoredDocumentPath } from './data-store';
import { DataTable, DOCUMENT_NAME_FIELD, getTableById, insertRows } from './data-tables';
import * as sqsService from './sqs-service';
import { config } from './config';

export type ProcessingStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ProcessingJob {
  id: string;
  user_id: string;
  document_id: number;
  status: ProcessingStatus;
  engine: string;
  result: any;
  confidence: number | null;
  error: string | null;
  target_table_id?: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  target_table?: Pick<DataTable, 'id' | 'name' | 'fields' | 'mappings'>;
  document?: DocumentRecord;
}

export async function createProcessingJobs(params: {
  userId: string;
  documentIds: number[];
  engine?: string;
  targetTableId?: string | null;
}): Promise<ProcessingJob[]> {
  if (params.documentIds.length === 0) {
    return [];
  }

  const documents = await db.query<{ id: number }>(
    `
    SELECT id
    FROM documents
    WHERE user_id = $1 AND id = ANY($2::int[]);
  `,
    [params.userId, params.documentIds]
  );

  if (documents.rowCount !== params.documentIds.length) {
    throw new Error('One or more documents are invalid');
  }

  const engine = params.engine || 'local_tesseract';
  const values = params.documentIds.map((docId) => [
    crypto.randomUUID(),
    params.userId,
    docId,
    'pending',
    engine,
    params.targetTableId || null,
  ]);

  const flatValues = values.flat();
  const placeholders = values
    .map((_, idx) => {
      const offset = idx * 6;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`;
    })
    .join(', ');

  const result = await db.query<ProcessingJob>(
    `
    INSERT INTO processing_jobs (id, user_id, document_id, status, engine, target_table_id)
    VALUES ${placeholders}
    RETURNING *;
  `,
    flatValues
  );

  // Send SQS messages for each job (if SQS is enabled)
  if (config.sqs.enabled) {
    // Get document details for SQS messages
    const docDetails = await db.query<DocumentRecord & { stored_filename: string; content_type: string }>(
      `
      SELECT id, filename, stored_filename, content_type
      FROM documents
      WHERE id = ANY($1::int[]);
    `,
      [params.documentIds]
    );

    const docMap = new Map(docDetails.rows.map((doc) => [doc.id, doc]));

    // Send SQS messages
    const sqsMessages = result.rows
      .map((job) => {
        const doc = docMap.get(job.document_id);
        if (!doc) {
          console.warn(`⚠️  Document ${job.document_id} not found for job ${job.id}`);
          return null;
        }

        return {
          jobId: job.id,
          documentId: job.document_id,
          userId: job.user_id,
          targetTableId: job.target_table_id || null,
          storageKey: doc.stored_filename,
          filename: doc.filename,
          contentType: doc.content_type,
        } as sqsService.OCRJobMessage;
      })
      .filter((msg): msg is sqsService.OCRJobMessage => msg !== null);

    // Send to SQS
    await sqsService.enqueueOCRJobs(sqsMessages);
  }

  return result.rows;
}

export async function listProcessingJobs(userId: string): Promise<ProcessingJob[]> {
  const result = await db.query<
    ProcessingJob & {
      target_table_name: string | null;
    }
  >(
    `
    SELECT pj.*, dt.name as target_table_name
    FROM processing_jobs pj
    LEFT JOIN data_tables dt ON pj.target_table_id = dt.id
    WHERE pj.user_id = $1
    ORDER BY pj.created_at DESC
    LIMIT 100;
  `,
    [userId]
  );

  return result.rows.map((row: ProcessingJob & { target_table_name: string | null }) => ({
    ...row,
    target_table: row.target_table_id
      ? {
          id: row.target_table_id,
          name: row.target_table_name || 'Untitled Table',
          fields: [],
        }
      : undefined,
  }));
}

export async function getProcessingJobForUser(jobId: string, userId: string): Promise<ProcessingJob | null> {
  const result = await db.query<ProcessingJob>(
    `
    SELECT *
    FROM processing_jobs
    WHERE id = $1 AND user_id = $2
    LIMIT 1;
  `,
    [jobId, userId]
  );

  return result.rows[0] ?? null;
}

export async function claimNextPendingJob(): Promise<
  (ProcessingJob & { file_path: string; document: DocumentRecord; target_table?: DataTable }) | null
> {
  const result = await db.query<ProcessingJob>(
    `
    UPDATE processing_jobs
    SET status = 'running', started_at = NOW(), updated_at = NOW()
    WHERE id = (
      SELECT id FROM processing_jobs
      WHERE status = 'pending'
      ORDER BY created_at
      LIMIT 1
    )
    RETURNING *;
  `
  );

  if (result.rowCount === 0) {
    return null;
  }

  const job = result.rows[0];
  const doc = await db.query<{
    user_id: string;
    filename: string;
    stored_filename: string;
    file_size: number;
    content_type: string;
    created_at: string;
  }>(
    `
    SELECT user_id, filename, stored_filename, file_size, content_type, created_at
    FROM documents
    WHERE id = $1;
  `,
    [job.document_id]
  );

  if (doc.rowCount === 0) {
    await failJob(job.id, 'Document missing');
    return null;
  }

  const documentRow = doc.rows[0];
  const document: DocumentRecord = {
    id: job.document_id,
    userId: documentRow.user_id,
    filename: documentRow.filename,
    storedFilename: documentRow.stored_filename,
    file_size: documentRow.file_size,
    content_type: documentRow.content_type,
    created_at: documentRow.created_at,
  };

  const file_path = getStoredDocumentPath(document);

  let targetTable: DataTable | undefined;
  if (job.target_table_id) {
    const table = await getTableById(job.target_table_id, job.user_id, true);
    if (table) {
      targetTable = table;
    }
  }

  return { ...job, file_path, document, target_table: targetTable };
}

export async function completeJob(params: {
  jobId: string;
  result: any;
  confidence?: number;
}): Promise<void> {
  const result = await db.query<ProcessingJob>(
    `
    UPDATE processing_jobs
    SET status = 'completed',
        result = $2,
        confidence = $3,
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `,
    [params.jobId, params.result, params.confidence ?? null]
  );

  const job = result.rows[0];
  if (job?.target_table_id) {
    await ingestResultIntoTable(job, params.result);
  }
}

export async function failJob(jobId: string, error: string): Promise<void> {
  await db.query(
    `
    UPDATE processing_jobs
    SET status = 'failed',
        error = $2,
        updated_at = NOW(),
        completed_at = NOW()
    WHERE id = $1;
  `,
    [jobId, error]
  );
}

async function ingestResultIntoTable(job: ProcessingJob, result: any) {
  if (!result) return;
  const rows = Array.isArray(result.rows)
    ? result.rows
    : result.fields
    ? [result.fields]
    : null;
  if (!rows || rows.length === 0) {
    return;
  }

  try {
    const doc = await db.query<{ filename: string }>(
      `SELECT filename FROM documents WHERE id = $1`,
      [job.document_id]
    );
    const documentName = doc.rows[0]?.filename || '';
    const normalizedRows = rows.map((row: Record<string, any>) => {
      const nextRow = { ...row };
      const cell = nextRow[DOCUMENT_NAME_FIELD];
      if (typeof cell === 'object' && cell !== null) {
        nextRow[DOCUMENT_NAME_FIELD] = cell;
      } else {
        nextRow[DOCUMENT_NAME_FIELD] = {
          value: cell ?? documentName,
          confidence: 1,
        };
      }
      return nextRow;
    });

    await insertRows({
      tableId: job.target_table_id!,
      userId: job.user_id,
      rows: normalizedRows,
    });
  } catch (error) {
    console.error('Failed to ingest OCR result', error);
  }
}

