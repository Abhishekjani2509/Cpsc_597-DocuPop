# =============================================================================
# DocuPop Infrastructure - Cognito User Pool
# =============================================================================

# -----------------------------------------------------------------------------
# User Pool
# -----------------------------------------------------------------------------

resource "aws_cognito_user_pool" "main" {
  name = "${local.name_prefix}-user-pool"

  # Username configuration
  username_attributes      = ["email"]
  auto_verified_attributes = var.cognito_auto_verify_email ? ["email"] : []

  # Username case sensitivity
  username_configuration {
    case_sensitive = false
  }

  # Password policy
  password_policy {
    minimum_length                   = var.cognito_password_min_length
    require_uppercase                = var.cognito_password_require_uppercase
    require_lowercase                = var.cognito_password_require_lowercase
    require_numbers                  = var.cognito_password_require_numbers
    require_symbols                  = var.cognito_password_require_symbols
    temporary_password_validity_days = 7
  }

  # Schema attributes
  schema {
    name                     = "email"
    attribute_data_type      = "String"
    required                 = true
    mutable                  = true
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  schema {
    name                     = "name"
    attribute_data_type      = "String"
    required                 = true
    mutable                  = true
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  # Account recovery
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Email configuration (use Cognito default)
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  # Verification message
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "DocuPop - Verify Your Email"
    email_message        = "Your verification code is {####}"
  }

  # MFA configuration - OPTIONAL allows users to enable TOTP MFA
  mfa_configuration = "OPTIONAL"

  # Software token MFA (TOTP) configuration
  software_token_mfa_configuration {
    enabled = true
  }

  # Admin create user config
  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  tags = {
    Name = "${local.name_prefix}-user-pool"
  }
}

# -----------------------------------------------------------------------------
# User Pool Client
# -----------------------------------------------------------------------------

resource "aws_cognito_user_pool_client" "main" {
  name         = "${local.name_prefix}-client"
  user_pool_id = aws_cognito_user_pool.main.id

  # No client secret (public client for SPA)
  generate_secret = false

  # Token validity
  access_token_validity  = 1  # hours
  id_token_validity      = 1  # hours
  refresh_token_validity = 30 # days

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  # Auth flows
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_ADMIN_USER_PASSWORD_AUTH"
  ]

  # Prevent user existence errors
  prevent_user_existence_errors = "ENABLED"

  # Supported identity providers
  supported_identity_providers = ["COGNITO"]

  # Read/write attributes
  read_attributes = [
    "email",
    "email_verified",
    "name",
  ]

  write_attributes = [
    "email",
    "name",
  ]
}

# -----------------------------------------------------------------------------
# User Pool Domain (optional - for hosted UI)
# -----------------------------------------------------------------------------

resource "aws_cognito_user_pool_domain" "main" {
  domain       = "${local.name_prefix}-${local.account_id}"
  user_pool_id = aws_cognito_user_pool.main.id
}
