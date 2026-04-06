# =============================================================================
# DocuPop Infrastructure - IAM Roles and Policies
# =============================================================================

# -----------------------------------------------------------------------------
# Lambda Execution Role
# -----------------------------------------------------------------------------

resource "aws_iam_role" "lambda_execution" {
  name = "${local.name_prefix}-lambda-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "${local.name_prefix}-lambda-execution-role"
  }
}

# -----------------------------------------------------------------------------
# CloudWatch Logs Policy
# -----------------------------------------------------------------------------

resource "aws_iam_role_policy" "lambda_logs" {
  name = "${local.name_prefix}-lambda-logs"
  role = aws_iam_role.lambda_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${var.aws_region}:${local.account_id}:*"
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# VPC Access Policy
# -----------------------------------------------------------------------------

resource "aws_iam_role_policy" "lambda_vpc" {
  name = "${local.name_prefix}-lambda-vpc"
  role = aws_iam_role.lambda_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ec2:CreateNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DeleteNetworkInterface",
          "ec2:AssignPrivateIpAddresses",
          "ec2:UnassignPrivateIpAddresses"
        ]
        Resource = "*"
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# S3 Access Policy
# -----------------------------------------------------------------------------

resource "aws_iam_role_policy" "lambda_s3" {
  name = "${local.name_prefix}-lambda-s3"
  role = aws_iam_role.lambda_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:GetObjectAcl",
          "s3:PutObjectAcl"
        ]
        Resource = "${aws_s3_bucket.documents.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.documents.arn
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# SQS Access Policy
# -----------------------------------------------------------------------------

resource "aws_iam_role_policy" "lambda_sqs" {
  name = "${local.name_prefix}-lambda-sqs"
  role = aws_iam_role.lambda_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SendMessages"
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",
          "sqs:GetQueueUrl",
          "sqs:GetQueueAttributes"
        ]
        Resource = aws_sqs_queue.ocr_jobs.arn
      },
      {
        Sid    = "ReceiveMessages"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ChangeMessageVisibility"
        ]
        Resource = aws_sqs_queue.ocr_jobs.arn
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Secrets Manager Access Policy
# -----------------------------------------------------------------------------

resource "aws_iam_role_policy" "lambda_secrets" {
  name = "${local.name_prefix}-lambda-secrets"
  role = aws_iam_role.lambda_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = aws_secretsmanager_secret.db_credentials.arn
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Textract Access Policy (for OCR Worker)
# -----------------------------------------------------------------------------

resource "aws_iam_role_policy" "lambda_textract" {
  name = "${local.name_prefix}-lambda-textract"
  role = aws_iam_role.lambda_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "TextractOperations"
        Effect = "Allow"
        Action = [
          "textract:DetectDocumentText",
          "textract:AnalyzeDocument",
          "textract:StartDocumentTextDetection",
          "textract:GetDocumentTextDetection",
          "textract:StartDocumentAnalysis",
          "textract:GetDocumentAnalysis",
          "textract:ListAdapters",
          "textract:ListAdapterVersions",
          "textract:GetAdapter",
          "textract:GetAdapterVersion"
        ]
        Resource = "*"
      },
      {
        Sid    = "TextractAdaptersS3Access"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::textract-adapters-${var.aws_region}-*",
          "arn:aws:s3:::textract-adapters-${var.aws_region}-*/*"
        ]
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Cognito Access Policy (for Authentication and MFA)
# -----------------------------------------------------------------------------

resource "aws_iam_role_policy" "lambda_cognito" {
  name = "${local.name_prefix}-lambda-cognito"
  role = aws_iam_role.lambda_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "CognitoUserOperations"
        Effect = "Allow"
        Action = [
          "cognito-idp:AdminInitiateAuth",
          "cognito-idp:AdminRespondToAuthChallenge",
          "cognito-idp:AdminGetUser",
          "cognito-idp:AdminConfirmSignUp",
          "cognito-idp:AdminSetUserMFAPreference",
          "cognito-idp:ListUsers",
          "cognito-idp:SignUp",
          "cognito-idp:GetUser",
          "cognito-idp:AssociateSoftwareToken",
          "cognito-idp:VerifySoftwareToken",
          "cognito-idp:SetUserMFAPreference",
          "cognito-idp:RespondToAuthChallenge"
        ]
        Resource = aws_cognito_user_pool.main.arn
      }
    ]
  })
}
