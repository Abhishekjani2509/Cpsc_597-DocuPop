"""
Lambda Handler for OCR Processing

Receives SQS messages with OCR job details, processes documents using AWS Textract,
and updates the database with results.

Security features:
- IAM role-based authentication
- Secrets Manager for database credentials
- VPC configuration for RDS access
- No hardcoded credentials

Environment variables:
- AWS_REGION: AWS region (auto-set by Lambda)
- DATABASE_SECRET_ARN: ARN of Secrets Manager secret with DB credentials
- S3_BUCKET_NAME: S3 bucket for documents
"""

import json
import os
import uuid as uuid_module
from typing import Dict, Any, Optional
import boto3
from botocore.exceptions import ClientError
import psycopg2
from psycopg2.extras import Json

import textract_ocr


def is_valid_uuid(value: str) -> bool:
    """Validate that a string is a valid UUID"""
    try:
        uuid_module.UUID(str(value))
        return True
    except (ValueError, AttributeError):
        return False


# Initialize AWS clients
secrets_client = boto3.client('secretsmanager')
s3_client = boto3.client('s3')

# Environment configuration
AWS_REGION = os.environ.get('AWS_REGION', 'us-west-1')
DATABASE_SECRET_ARN = os.environ.get('DATABASE_SECRET_ARN')
S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME')

# Database connection settings (can be overridden by env vars)
DB_HOST = os.environ.get('PGHOST')
DB_PORT = int(os.environ.get('PGPORT', 5432))
DB_NAME = os.environ.get('PGDATABASE', 'postgres')
DB_USER = os.environ.get('PGUSER')
DB_PASSWORD = os.environ.get('PGPASSWORD')

# Cache database connection
_db_connection = None


def get_database_credentials() -> Dict[str, str]:
    """
    Retrieve database credentials from environment variables or AWS Secrets Manager.

    Returns:
        Dictionary with host, port, username, password, database
    """
    # If all required env vars are set, use them directly
    if DB_HOST and DB_USER and DB_PASSWORD:
        return {
            'host': DB_HOST,
            'port': DB_PORT,
            'username': DB_USER,
            'password': DB_PASSWORD,
            'database': DB_NAME,
        }

    # Fall back to Secrets Manager
    if not DATABASE_SECRET_ARN:
        raise ValueError("DATABASE_SECRET_ARN or PGHOST/PGUSER/PGPASSWORD environment variables not set")

    try:
        response = secrets_client.get_secret_value(SecretId=DATABASE_SECRET_ARN)
        secret = json.loads(response['SecretString'])

        return {
            'host': secret.get('host', DB_HOST),
            'port': secret.get('port', DB_PORT),
            'username': secret.get('username', DB_USER),
            'password': secret.get('password', DB_PASSWORD),
            'database': secret.get('dbname', secret.get('database', DB_NAME)),
        }
    except ClientError as e:
        error_code = e.response['Error']['Code']
        raise Exception(f"Failed to retrieve database credentials: {error_code}")


def get_database_connection():
    """
    Get or create database connection (reused across Lambda invocations).

    Returns:
        psycopg2 connection object
    """
    global _db_connection

    # Check if connection exists and is alive
    if _db_connection is not None:
        try:
            # Test connection
            cursor = _db_connection.cursor()
            cursor.execute('SELECT 1')
            cursor.close()
            return _db_connection
        except Exception:
            # Connection is dead, close it
            try:
                _db_connection.close()
            except Exception:
                pass
            _db_connection = None

    # Create new connection
    creds = get_database_credentials()
    _db_connection = psycopg2.connect(
        host=creds['host'],
        port=creds['port'],
        user=creds['username'],
        password=creds['password'],
        dbname=creds['database'],
        connect_timeout=10,
        sslmode='require'
    )

    return _db_connection


def get_target_table(table_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    """
    Fetch target table schema from database.

    Args:
        table_id: Table ID
        user_id: User ID

    Returns:
        Table schema with fields and mappings, or None if not found
    """
    conn = get_database_connection()
    cursor = conn.cursor()

    try:
        # Get table info
        cursor.execute(
            """
            SELECT id, name
            FROM data_tables
            WHERE id = %s AND user_id = %s
            LIMIT 1
            """,
            (table_id, user_id)
        )

        row = cursor.fetchone()
        if not row:
            return None

        table_id = row[0]
        table_name = row[1]

        # Get fields from data_fields table
        cursor.execute(
            """
            SELECT id, name, data_type, position
            FROM data_fields
            WHERE table_id = %s
            ORDER BY position
            """,
            (table_id,)
        )
        fields = [
            {"id": str(r[0]), "name": r[1], "data_type": r[2], "position": r[3]}
            for r in cursor.fetchall()
        ]

        # Get mappings from data_field_mappings table
        cursor.execute(
            """
            SELECT id, source_label, target_field, matcher
            FROM data_field_mappings
            WHERE table_id = %s
            """,
            (table_id,)
        )
        mappings = [
            {"id": str(r[0]), "source_label": r[1], "target_field": r[2], "matcher": r[3]}
            for r in cursor.fetchall()
        ]

        return {
            'id': table_id,
            'name': table_name,
            'fields': fields,
            'mappings': mappings,
        }
    finally:
        cursor.close()


def update_job_status(
    job_id: str,
    status: str,
    result: Optional[Dict[str, Any]] = None,
    confidence: Optional[float] = None,
    error: Optional[str] = None
):
    """
    Update processing job status in database.

    Args:
        job_id: Job ID
        status: New status ('completed' or 'failed')
        result: OCR result (for completed jobs)
        confidence: Confidence score (for completed jobs)
        error: Error message (for failed jobs)
    """
    conn = get_database_connection()
    cursor = conn.cursor()

    try:
        if status == 'completed':
            cursor.execute(
                """
                UPDATE processing_jobs
                SET status = 'completed',
                    result = %s,
                    confidence = %s,
                    completed_at = NOW(),
                    updated_at = NOW()
                WHERE id = %s
                """,
                (Json(result), confidence, job_id)
            )
        elif status == 'failed':
            cursor.execute(
                """
                UPDATE processing_jobs
                SET status = 'failed',
                    error = %s,
                    completed_at = NOW(),
                    updated_at = NOW()
                WHERE id = %s
                """,
                (error, job_id)
            )
        else:
            raise ValueError(f"Invalid status: {status}")

        conn.commit()
        print(f"[INFO] Job {job_id} marked as {status}")

    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cursor.close()


def insert_row_to_target_table(
    table_id: str,
    user_id: str,
    fields: Dict[str, Any],
    target_table: Dict[str, Any]
) -> Optional[str]:
    """
    Insert extracted OCR data as a new row in the target table.

    Args:
        table_id: Target table ID
        user_id: User ID (not used in insert, but kept for logging)
        fields: Extracted fields from OCR {field_name: {value, confidence}}
        target_table: Target table schema with fields list

    Returns:
        Row ID if successful, None otherwise
    """
    import uuid as uuid_module

    conn = get_database_connection()
    cursor = conn.cursor()

    try:
        # Build the data object mapping table field names to extracted values
        # Each field stores both value and confidence
        table_fields = target_table.get('fields', [])
        row_data = {}

        print(f"[INFO] Building row data from {len(fields)} extracted fields for {len(table_fields)} table columns")

        for table_field in table_fields:
            field_name = table_field.get('name', '')
            if not field_name:
                continue

            # Check if we have extracted data for this field
            if field_name in fields:
                field_data = fields[field_name]
                if isinstance(field_data, dict):
                    # Store both value and confidence
                    row_data[field_name] = {
                        'value': field_data.get('value', ''),
                        'confidence': field_data.get('confidence', None)
                    }
                else:
                    row_data[field_name] = {
                        'value': field_data,
                        'confidence': None
                    }
                display_val = str(row_data[field_name]['value'])[:50]
                conf = row_data[field_name]['confidence']
                conf_str = f" ({conf*100:.0f}%)" if conf else ""
                print(f"[INFO] Mapped '{field_name}' = '{display_val}'{conf_str}")

        # Only insert if we have some data
        if not row_data:
            print(f"[WARN] No matching fields found for table {table_id}")
            return None

        # Generate row ID
        row_id = str(uuid_module.uuid4())

        # Insert the row (data_rows table doesn't have user_id column)
        cursor.execute(
            """
            INSERT INTO data_rows (id, table_id, data, created_at, updated_at)
            VALUES (%s, %s, %s, NOW(), NOW())
            """,
            (row_id, table_id, Json(row_data))
        )

        conn.commit()
        print(f"[INFO] Inserted row {row_id} into table {table_id} with {len(row_data)} fields")
        return row_id

    except Exception as e:
        conn.rollback()
        print(f"[ERROR] Failed to insert row into table {table_id}: {e}")
        raise e
    finally:
        cursor.close()


def process_ocr_job(message: Dict[str, Any]):
    """
    Process a single OCR job from SQS message.

    Args:
        message: SQS message body with job details

    Message format:
    {
        "jobId": "uuid",
        "documentId": 123,
        "userId": "user-uuid",
        "targetTableId": "table-uuid" (optional),
        "storageKey": "s3-key",
        "filename": "document.pdf",
        "contentType": "application/pdf",
        "queries": [...] (optional) - Custom Textract queries for targeted extraction,
        "adapterId": "adapter-id" (optional) - Custom adapter for specialized documents,
        "adapterVersion": "version" (optional) - Specific adapter version
    }
    """
    job_id = message['jobId']
    document_id = message['documentId']
    user_id = message['userId']
    target_table_id = message.get('targetTableId')
    storage_key = message['storageKey']
    filename = message['filename']
    queries = message.get('queries')
    adapter_id = message.get('adapterId')
    adapter_version = message.get('adapterVersion')
    adapter_feature_types = message.get('adapterFeatureTypes')

    # Validate job_id is a proper UUID
    if not is_valid_uuid(job_id):
        raise ValueError(f"Invalid job ID format: {job_id}. Expected UUID format.")

    # Validate user_id is a proper UUID
    if not is_valid_uuid(user_id):
        raise ValueError(f"Invalid user ID format: {user_id}. Expected UUID format.")

    print(f"[INFO] Processing job {job_id} for document {filename}")

    try:
        # Get target table schema if specified
        target_table = None
        if target_table_id:
            target_table = get_target_table(target_table_id, user_id)
            if target_table:
                print(f"[INFO] Using target table: {target_table['name']}")

        # Verify S3 bucket is configured
        if not S3_BUCKET_NAME:
            raise ValueError("S3_BUCKET_NAME environment variable not set")

        # Process document with Textract (directly from S3)
        # Uses AnalyzeDocument with queries/adapter if provided, otherwise basic DetectDocumentText
        print(f"[INFO] Extracting text with Textract from s3://{S3_BUCKET_NAME}/{storage_key}")
        if queries:
            print(f"[INFO] Using {len(queries)} custom queries")
        if adapter_id:
            print(f"[INFO] Using custom adapter: {adapter_id}")

        result = textract_ocr.process_document_from_s3(
            bucket=S3_BUCKET_NAME,
            key=storage_key,
            target_table=target_table,
            document_name=filename,
            queries=queries,
            adapter_id=adapter_id,
            adapter_version=adapter_version,
            adapter_feature_types=adapter_feature_types
        )

        confidence = result.get('confidence', 0.5)
        fields = result.get('fields', {})
        field_count = len(fields)

        print(f"[INFO] Extracted {field_count} fields with confidence {confidence:.2f}")

        # Insert extracted data as a row in target table
        row_id = None
        if target_table and target_table_id and fields:
            try:
                row_id = insert_row_to_target_table(
                    table_id=target_table_id,
                    user_id=user_id,
                    fields=fields,
                    target_table=target_table
                )
                if row_id:
                    result['inserted_row_id'] = row_id
                    print(f"[INFO] Data inserted into table {target_table['name']}")
            except Exception as insert_error:
                print(f"[WARN] Failed to insert row (non-fatal): {insert_error}")
                result['insert_error'] = str(insert_error)

        # Update job as completed
        update_job_status(
            job_id=job_id,
            status='completed',
            result=result,
            confidence=confidence
        )

        print(f"[INFO] Job {job_id} completed successfully")

    except Exception as e:
        error_message = str(e)
        print(f"[ERROR] Job {job_id} failed: {error_message}")

        # Update job as failed
        update_job_status(
            job_id=job_id,
            status='failed',
            error=error_message
        )

        # Re-raise to mark SQS message as failed (will go to DLQ after retries)
        raise e


def lambda_handler(event, context):
    """
    Lambda entry point for SQS-triggered OCR processing.

    Args:
        event: Lambda event (SQS messages)
        context: Lambda context

    Event format:
    {
        "Records": [
            {
                "body": "{...job message...}",
                "messageId": "...",
                ...
            }
        ]
    }
    """
    print(f"[INFO] Received {len(event.get('Records', []))} SQS messages")

    # Process each message
    for record in event.get('Records', []):
        try:
            # Parse message body
            message = json.loads(record['body'])
            print(f"[INFO] Processing message: {record.get('messageId', 'unknown')}")

            # Process the job
            process_ocr_job(message)

        except json.JSONDecodeError as e:
            print(f"[ERROR] Invalid JSON in message: {e}")
            # Don't re-raise - let SQS delete this malformed message
            continue

        except Exception as e:
            print(f"[ERROR] Error processing message: {e}")
            # Re-raise to keep message in queue for retry
            raise e

    print("[INFO] All messages processed successfully")

    return {
        'statusCode': 200,
        'body': json.dumps({'message': 'Processing complete'})
    }
