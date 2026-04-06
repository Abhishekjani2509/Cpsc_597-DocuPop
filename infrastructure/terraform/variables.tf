# =============================================================================
# DocuPop Infrastructure - Input Variables
# =============================================================================

# -----------------------------------------------------------------------------
# General Configuration
# -----------------------------------------------------------------------------

variable "project_name" {
  description = "Name of the project (used for resource naming)"
  type        = string
  default     = "docupop"
}

variable "environment" {
  description = "Environment name (e.g., staging, production)"
  type        = string
  default     = "staging"

  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be one of: dev, staging, production."
  }
}

variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-west-1"
}

# -----------------------------------------------------------------------------
# Networking Configuration
# -----------------------------------------------------------------------------

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "enable_nat_gateway" {
  description = "Enable NAT Gateway for private subnet internet access"
  type        = bool
  default     = true
}

variable "single_nat_gateway" {
  description = "Use a single NAT Gateway (cost savings for non-prod)"
  type        = bool
  default     = true
}

# -----------------------------------------------------------------------------
# Database Configuration
# -----------------------------------------------------------------------------

variable "db_name" {
  description = "Name of the PostgreSQL database"
  type        = string
  default     = "postgres"
}

variable "db_master_username" {
  description = "Master username for RDS"
  type        = string
  default     = "docupop_master"
}

variable "db_min_capacity" {
  description = "Minimum Aurora Serverless v2 ACU capacity"
  type        = number
  default     = 0.5
}

variable "db_max_capacity" {
  description = "Maximum Aurora Serverless v2 ACU capacity"
  type        = number
  default     = 4
}

variable "db_skip_final_snapshot" {
  description = "Skip final snapshot when destroying database"
  type        = bool
  default     = false
}

variable "db_deletion_protection" {
  description = "Enable deletion protection for the database"
  type        = bool
  default     = true
}

# -----------------------------------------------------------------------------
# Lambda Configuration
# -----------------------------------------------------------------------------

variable "lambda_api_memory" {
  description = "Memory allocation for API Lambda (MB)"
  type        = number
  default     = 512
}

variable "lambda_api_timeout" {
  description = "Timeout for API Lambda (seconds)"
  type        = number
  default     = 30
}

variable "lambda_ocr_memory" {
  description = "Memory allocation for OCR Worker Lambda (MB)"
  type        = number
  default     = 1536
}

variable "lambda_ocr_timeout" {
  description = "Timeout for OCR Worker Lambda (seconds)"
  type        = number
  default     = 900
}

variable "lambda_runtime" {
  description = "Python runtime version for Lambda"
  type        = string
  default     = "python3.11"
}

# -----------------------------------------------------------------------------
# S3 Configuration
# -----------------------------------------------------------------------------

variable "s3_force_destroy" {
  description = "Allow destroying S3 bucket with objects"
  type        = bool
  default     = false
}

variable "s3_versioning_enabled" {
  description = "Enable versioning on the S3 bucket"
  type        = bool
  default     = true
}

# -----------------------------------------------------------------------------
# SQS Configuration
# -----------------------------------------------------------------------------

variable "sqs_visibility_timeout" {
  description = "SQS message visibility timeout (seconds)"
  type        = number
  default     = 960
}

variable "sqs_message_retention" {
  description = "SQS message retention period (seconds)"
  type        = number
  default     = 345600 # 4 days
}

variable "sqs_max_receive_count" {
  description = "Max receives before message goes to DLQ"
  type        = number
  default     = 3
}

# -----------------------------------------------------------------------------
# Cognito Configuration
# -----------------------------------------------------------------------------

variable "cognito_auto_verify_email" {
  description = "Auto-verify email addresses"
  type        = bool
  default     = true
}

variable "cognito_password_min_length" {
  description = "Minimum password length"
  type        = number
  default     = 8
}

variable "cognito_password_require_uppercase" {
  description = "Require uppercase in password"
  type        = bool
  default     = true
}

variable "cognito_password_require_lowercase" {
  description = "Require lowercase in password"
  type        = bool
  default     = true
}

variable "cognito_password_require_numbers" {
  description = "Require numbers in password"
  type        = bool
  default     = true
}

variable "cognito_password_require_symbols" {
  description = "Require symbols in password"
  type        = bool
  default     = false
}

# -----------------------------------------------------------------------------
# CORS Configuration
# -----------------------------------------------------------------------------

variable "allowed_origins" {
  description = "List of allowed CORS origins"
  type        = list(string)
  default     = ["http://localhost:3000"]
}

# -----------------------------------------------------------------------------
# Deployment Paths
# -----------------------------------------------------------------------------

variable "lambda_api_source_path" {
  description = "Path to the API Lambda source code"
  type        = string
  default     = "../lambda/api"
}

variable "lambda_ocr_dockerfile_path" {
  description = "Path to the OCR Worker Dockerfile"
  type        = string
  default     = "../../services/ocr-worker"
}

# -----------------------------------------------------------------------------
# Amplify Configuration
# -----------------------------------------------------------------------------

variable "github_repository_url" {
  description = "GitHub repository URL for Amplify (e.g., https://github.com/username/repo)"
  type        = string
  default     = ""
}

variable "github_access_token" {
  description = "GitHub personal access token for Amplify to access the repository"
  type        = string
  sensitive   = true
  default     = ""
}

variable "amplify_auto_branch_creation" {
  description = "Enable automatic branch creation for feature branches"
  type        = bool
  default     = false
}

variable "amplify_auto_branch_patterns" {
  description = "Patterns for automatic branch creation"
  type        = list(string)
  default     = ["feature/*", "fix/*"]
}

variable "amplify_enable_pr_preview" {
  description = "Enable pull request preview environments"
  type        = bool
  default     = false
}

variable "amplify_domain_name" {
  description = "Custom domain name for Amplify (leave empty to skip)"
  type        = string
  default     = ""
}
