# =============================================================================
# DocuPop Infrastructure - Outputs
# =============================================================================

# -----------------------------------------------------------------------------
# API Outputs
# -----------------------------------------------------------------------------

output "api_gateway_url" {
  description = "Base URL for the API Gateway"
  value       = "${aws_api_gateway_stage.main.invoke_url}"
}

output "api_gateway_id" {
  description = "API Gateway REST API ID"
  value       = aws_api_gateway_rest_api.main.id
}

output "api_gateway_stage_name" {
  description = "API Gateway stage name"
  value       = aws_api_gateway_stage.main.stage_name
}

# -----------------------------------------------------------------------------
# Lambda Outputs
# -----------------------------------------------------------------------------

output "api_lambda_function_name" {
  description = "Name of the API Lambda function"
  value       = aws_lambda_function.api.function_name
}

output "api_lambda_function_arn" {
  description = "ARN of the API Lambda function"
  value       = aws_lambda_function.api.arn
}

output "ocr_worker_function_name" {
  description = "Name of the OCR Worker Lambda function"
  value       = aws_lambda_function.ocr_worker.function_name
}

output "ocr_worker_function_arn" {
  description = "ARN of the OCR Worker Lambda function"
  value       = aws_lambda_function.ocr_worker.arn
}

# -----------------------------------------------------------------------------
# Database Outputs
# -----------------------------------------------------------------------------

output "database_endpoint" {
  description = "RDS instance endpoint"
  value       = aws_db_instance.main.address
  sensitive   = true
}

output "database_name" {
  description = "Database name"
  value       = aws_db_instance.main.db_name
}

output "database_port" {
  description = "Database port"
  value       = aws_db_instance.main.port
}

output "database_secret_arn" {
  description = "ARN of the Secrets Manager secret containing DB credentials"
  value       = aws_secretsmanager_secret.db_credentials.arn
}

# -----------------------------------------------------------------------------
# S3 Outputs
# -----------------------------------------------------------------------------

output "s3_bucket_name" {
  description = "Name of the documents S3 bucket"
  value       = aws_s3_bucket.documents.id
}

output "s3_bucket_arn" {
  description = "ARN of the documents S3 bucket"
  value       = aws_s3_bucket.documents.arn
}

# -----------------------------------------------------------------------------
# SQS Outputs
# -----------------------------------------------------------------------------

output "sqs_queue_url" {
  description = "URL of the OCR jobs SQS queue"
  value       = aws_sqs_queue.ocr_jobs.url
}

output "sqs_queue_arn" {
  description = "ARN of the OCR jobs SQS queue"
  value       = aws_sqs_queue.ocr_jobs.arn
}

output "sqs_dlq_url" {
  description = "URL of the dead letter queue"
  value       = aws_sqs_queue.ocr_dlq.url
}

# -----------------------------------------------------------------------------
# Cognito Outputs
# -----------------------------------------------------------------------------

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  value       = aws_cognito_user_pool.main.id
}

output "cognito_user_pool_arn" {
  description = "Cognito User Pool ARN"
  value       = aws_cognito_user_pool.main.arn
}

output "cognito_client_id" {
  description = "Cognito App Client ID"
  value       = aws_cognito_user_pool_client.main.id
}

# -----------------------------------------------------------------------------
# ECR Outputs
# -----------------------------------------------------------------------------

output "ecr_repository_url" {
  description = "ECR repository URL for OCR worker"
  value       = aws_ecr_repository.ocr_worker.repository_url
}

output "ecr_repository_arn" {
  description = "ECR repository ARN"
  value       = aws_ecr_repository.ocr_worker.arn
}

# -----------------------------------------------------------------------------
# VPC Outputs
# -----------------------------------------------------------------------------

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "private_subnet_ids" {
  description = "List of private subnet IDs"
  value       = aws_subnet.private[*].id
}

output "public_subnet_ids" {
  description = "List of public subnet IDs"
  value       = aws_subnet.public[*].id
}

# -----------------------------------------------------------------------------
# CloudWatch Outputs
# -----------------------------------------------------------------------------

output "api_lambda_log_group" {
  description = "CloudWatch Log Group for API Lambda"
  value       = aws_cloudwatch_log_group.api_lambda.name
}

output "ocr_worker_log_group" {
  description = "CloudWatch Log Group for OCR Worker Lambda"
  value       = aws_cloudwatch_log_group.ocr_worker.name
}

output "api_gateway_log_group" {
  description = "CloudWatch Log Group for API Gateway"
  value       = aws_cloudwatch_log_group.api_gateway.name
}

# -----------------------------------------------------------------------------
# Useful Connection Strings (for development/debugging)
# -----------------------------------------------------------------------------

output "frontend_config" {
  description = "Configuration values for frontend .env file"
  value = {
    NEXT_PUBLIC_LOCAL_API_BASE = aws_api_gateway_stage.main.invoke_url
    NEXT_PUBLIC_AWS_REGION     = var.aws_region
    COGNITO_USER_POOL_ID       = aws_cognito_user_pool.main.id
    COGNITO_USER_POOL_CLIENT_ID = aws_cognito_user_pool_client.main.id
  }
}

output "lambda_update_commands" {
  description = "Commands to update Lambda functions"
  value = {
    api_lambda = "aws lambda update-function-code --function-name ${aws_lambda_function.api.function_name} --zip-file fileb://api-lambda.zip --region ${var.aws_region}"
    ocr_worker = "aws ecr get-login-password --region ${var.aws_region} | docker login --username AWS --password-stdin ${aws_ecr_repository.ocr_worker.repository_url} && docker push ${aws_ecr_repository.ocr_worker.repository_url}:latest && aws lambda update-function-code --function-name ${aws_lambda_function.ocr_worker.function_name} --image-uri ${aws_ecr_repository.ocr_worker.repository_url}:latest --region ${var.aws_region}"
  }
}

# -----------------------------------------------------------------------------
# Amplify Outputs
# -----------------------------------------------------------------------------

output "amplify_app_id" {
  description = "Amplify App ID"
  value       = var.github_repository_url != "" ? aws_amplify_app.frontend[0].id : null
}

output "amplify_default_domain" {
  description = "Amplify default domain"
  value       = var.github_repository_url != "" ? aws_amplify_app.frontend[0].default_domain : null
}

output "amplify_production_url" {
  description = "Amplify production branch URL"
  value       = var.github_repository_url != "" ? "https://main.${aws_amplify_app.frontend[0].default_domain}" : null
}

output "amplify_staging_url" {
  description = "Amplify staging branch URL"
  value       = var.github_repository_url != "" ? "https://staging.${aws_amplify_app.frontend[0].default_domain}" : null
}
