# =============================================================================
# DocuPop Infrastructure - SQS Queues
# =============================================================================

# -----------------------------------------------------------------------------
# Dead Letter Queue
# -----------------------------------------------------------------------------

resource "aws_sqs_queue" "ocr_dlq" {
  name = "${local.name_prefix}-ocr-jobs-dlq"

  message_retention_seconds = 1209600 # 14 days

  tags = {
    Name = "${local.name_prefix}-ocr-jobs-dlq"
  }
}

# -----------------------------------------------------------------------------
# Main OCR Jobs Queue
# -----------------------------------------------------------------------------

resource "aws_sqs_queue" "ocr_jobs" {
  name = "${local.name_prefix}-ocr-jobs"

  visibility_timeout_seconds = var.sqs_visibility_timeout
  message_retention_seconds  = var.sqs_message_retention
  receive_wait_time_seconds  = 20 # Long polling

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.ocr_dlq.arn
    maxReceiveCount     = var.sqs_max_receive_count
  })

  tags = {
    Name = "${local.name_prefix}-ocr-jobs"
  }
}

# -----------------------------------------------------------------------------
# Queue Policies
# -----------------------------------------------------------------------------

resource "aws_sqs_queue_policy" "ocr_jobs" {
  queue_url = aws_sqs_queue.ocr_jobs.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowLambdaSend"
        Effect    = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action   = "sqs:SendMessage"
        Resource = aws_sqs_queue.ocr_jobs.arn
        Condition = {
          ArnLike = {
            "aws:SourceArn" = "arn:aws:lambda:${var.aws_region}:${local.account_id}:function:${local.name_prefix}-*"
          }
        }
      }
    ]
  })
}
