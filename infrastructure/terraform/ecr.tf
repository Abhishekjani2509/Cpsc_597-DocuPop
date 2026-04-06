# =============================================================================
# DocuPop Infrastructure - ECR Repository
# =============================================================================

# -----------------------------------------------------------------------------
# ECR Repository for OCR Worker
# -----------------------------------------------------------------------------

resource "aws_ecr_repository" "ocr_worker" {
  name                 = "${local.name_prefix}-ocr-worker"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = {
    Name = "${local.name_prefix}-ocr-worker"
  }
}

# -----------------------------------------------------------------------------
# ECR Lifecycle Policy
# -----------------------------------------------------------------------------

resource "aws_ecr_lifecycle_policy" "ocr_worker" {
  repository = aws_ecr_repository.ocr_worker.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus     = "any"
          countType     = "imageCountMoreThan"
          countNumber   = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Null Resource to Build and Push Initial Image
# -----------------------------------------------------------------------------

resource "null_resource" "ocr_worker_image" {
  triggers = {
    dockerfile_hash = filemd5("${path.module}/${var.lambda_ocr_dockerfile_path}/Dockerfile.lambda")
    handler_hash    = filemd5("${path.module}/${var.lambda_ocr_dockerfile_path}/lambda_handler.py")
    ocr_hash        = filemd5("${path.module}/${var.lambda_ocr_dockerfile_path}/textract_ocr.py")
  }

  provisioner "local-exec" {
    command = <<-EOT
      aws ecr get-login-password --region ${var.aws_region} | docker login --username AWS --password-stdin ${aws_ecr_repository.ocr_worker.repository_url}
      docker buildx build --platform linux/amd64 \
        -f ${path.module}/${var.lambda_ocr_dockerfile_path}/Dockerfile.lambda \
        -t ${aws_ecr_repository.ocr_worker.repository_url}:latest \
        --provenance=false --sbom=false \
        ${path.module}/${var.lambda_ocr_dockerfile_path}
      docker push ${aws_ecr_repository.ocr_worker.repository_url}:latest
    EOT
  }

  depends_on = [aws_ecr_repository.ocr_worker]
}
