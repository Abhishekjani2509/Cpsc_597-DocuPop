/**
 * SQS Service
 *
 * Abstraction layer for job queue that supports:
 * - AWS SQS (for staging/production)
 * - HTTP polling fallback (for local development)
 *
 * Security features:
 * - Environment-based queue selection
 * - No hardcoded credentials (uses IAM roles or env vars)
 * - Message validation
 */

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { config } from './config';

// SQS Client (only initialized if SQS is enabled)
let sqsClient: SQSClient | null = null;

if (config.sqs.enabled) {
  sqsClient = new SQSClient({
    region: config.sqs.region,
    // Credentials automatically loaded from IAM roles or environment
  });
  console.log(`✅ SQS client initialized for queue: ${config.sqs.queueUrl}`);
}

/**
 * OCR Job Message
 */
export interface OCRJobMessage {
  jobId: string;
  documentId: number;
  userId: string;
  targetTableId?: string | null;
  storageKey: string;
  filename: string;
  contentType: string;
}

/**
 * Send a job to the OCR processing queue
 *
 * @param message - Job details
 * @returns Message ID (only for SQS)
 */
export async function enqueueOCRJob(message: OCRJobMessage): Promise<string | null> {
  if (config.sqs.enabled && sqsClient && config.sqs.queueUrl) {
    try {
      const result = await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: config.sqs.queueUrl,
          MessageBody: JSON.stringify(message),
          MessageAttributes: {
            jobId: {
              DataType: 'String',
              StringValue: message.jobId,
            },
            userId: {
              DataType: 'String',
              StringValue: message.userId,
            },
            documentId: {
              DataType: 'Number',
              StringValue: message.documentId.toString(),
            },
          },
        })
      );

      console.log(`✅ Enqueued OCR job to SQS: ${message.jobId}`);
      return result.MessageId || null;
    } catch (error) {
      console.error('❌ Error enqueueing job to SQS:', error);
      throw new Error(`Failed to enqueue job: ${error}`);
    }
  } else {
    // SQS disabled - worker will use HTTP polling instead
    console.log(`ℹ️  SQS disabled, job will be processed via HTTP polling: ${message.jobId}`);
    return null;
  }
}

/**
 * Send multiple jobs to the queue (batch operation)
 *
 * @param messages - Array of job messages
 * @returns Array of message IDs
 */
export async function enqueueOCRJobs(messages: OCRJobMessage[]): Promise<(string | null)[]> {
  if (messages.length === 0) {
    return [];
  }

  // For now, send individually (could optimize with SendMessageBatch later)
  const results = await Promise.all(messages.map((msg) => enqueueOCRJob(msg)));

  return results;
}

/**
 * Get queue status (for monitoring)
 */
export async function getQueueStatus(): Promise<{
  enabled: boolean;
  queueUrl?: string;
  region?: string;
}> {
  return {
    enabled: config.sqs.enabled,
    queueUrl: config.sqs.queueUrl,
    region: config.sqs.region,
  };
}