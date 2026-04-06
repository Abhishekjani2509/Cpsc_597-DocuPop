# =============================================================================
# DocuPop Infrastructure - OCR Worker Lambda Function
# =============================================================================

# -----------------------------------------------------------------------------
# CloudWatch Log Group
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "ocr_worker" {
  name              = "/aws/lambda/${local.name_prefix}-ocr-worker"
  retention_in_days = 14

  tags = {
    Name = "${local.name_prefix}-ocr-worker-logs"
  }
}

# -----------------------------------------------------------------------------
# Lambda Function (Container Image)
# -----------------------------------------------------------------------------

resource "aws_lambda_function" "ocr_worker" {
  function_name = "${local.name_prefix}-ocr-worker"

  package_type = "Image"
  image_uri    = "${aws_ecr_repository.ocr_worker.repository_url}:latest"

  role        = aws_iam_role.lambda_execution.arn
  memory_size = var.lambda_ocr_memory
  timeout     = var.lambda_ocr_timeout

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      PGHOST              = aws_db_instance.main.address
      PGPORT              = tostring(aws_db_instance.main.port)
      PGDATABASE          = aws_db_instance.main.db_name
      PGUSER              = aws_db_instance.main.username
      PGPASSWORD          = random_password.db_password.result
      S3_BUCKET_NAME      = aws_s3_bucket.documents.id
      DATABASE_SECRET_ARN = aws_secretsmanager_secret.db_credentials.arn
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.ocr_worker,
    aws_iam_role_policy.lambda_logs,
    aws_iam_role_policy.lambda_vpc,
    aws_iam_role_policy.lambda_textract,
    aws_db_instance.main,
    null_resource.ocr_worker_image
  ]

  tags = {
    Name = "${local.name_prefix}-ocr-worker"
  }
}

# -----------------------------------------------------------------------------
# SQS Trigger
# -----------------------------------------------------------------------------

resource "aws_lambda_event_source_mapping" "ocr_sqs" {
  event_source_arn = aws_sqs_queue.ocr_jobs.arn
  function_name    = aws_lambda_function.ocr_worker.arn
  enabled          = true
  batch_size       = 10

  scaling_config {
    maximum_concurrency = 10
  }

  depends_on = [aws_iam_role_policy.lambda_sqs]
}
