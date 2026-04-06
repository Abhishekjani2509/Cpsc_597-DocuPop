# =============================================================================
# DocuPop Infrastructure - API Lambda Function
# =============================================================================

# -----------------------------------------------------------------------------
# Lambda Package
# -----------------------------------------------------------------------------

data "archive_file" "api_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/${var.lambda_api_source_path}"
  output_path = "${path.module}/dist/api-lambda.zip"

  excludes = [
    "__pycache__",
    "*.pyc",
    ".pytest_cache",
    "tests",
    "*.zip",
    "env-vars.json"
  ]
}

# -----------------------------------------------------------------------------
# CloudWatch Log Group
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "api_lambda" {
  name              = "/aws/lambda/${local.name_prefix}-api"
  retention_in_days = 14

  tags = {
    Name = "${local.name_prefix}-api-logs"
  }
}

# -----------------------------------------------------------------------------
# Lambda Function
# -----------------------------------------------------------------------------

resource "aws_lambda_function" "api" {
  function_name = "${local.name_prefix}-api"

  filename         = data.archive_file.api_lambda.output_path
  source_code_hash = data.archive_file.api_lambda.output_base64sha256

  handler = "handler.handler"
  runtime = var.lambda_runtime

  role        = aws_iam_role.lambda_execution.arn
  memory_size = var.lambda_api_memory
  timeout     = var.lambda_api_timeout

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      PGHOST               = aws_db_instance.main.address
      PGPORT               = tostring(aws_db_instance.main.port)
      PGDATABASE           = aws_db_instance.main.db_name
      PGUSER               = aws_db_instance.main.username
      PGPASSWORD           = random_password.db_password.result
      S3_BUCKET_NAME       = aws_s3_bucket.documents.id
      SQS_QUEUE_URL        = aws_sqs_queue.ocr_jobs.url
      COGNITO_USER_POOL_ID = aws_cognito_user_pool.main.id
      COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.main.id
      DATABASE_SECRET_ARN  = aws_secretsmanager_secret.db_credentials.arn
      ALLOWED_ORIGINS      = jsonencode(var.allowed_origins)
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.api_lambda,
    aws_iam_role_policy.lambda_logs,
    aws_iam_role_policy.lambda_vpc,
    aws_db_instance.main
  ]

  tags = {
    Name = "${local.name_prefix}-api"
  }
}

# -----------------------------------------------------------------------------
# Lambda Permission for API Gateway
# -----------------------------------------------------------------------------

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*"
}
