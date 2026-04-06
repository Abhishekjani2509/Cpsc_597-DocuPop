# =============================================================================
# DocuPop Infrastructure - AWS Amplify Frontend Hosting
# =============================================================================

# -----------------------------------------------------------------------------
# Amplify App
# -----------------------------------------------------------------------------

resource "aws_amplify_app" "frontend" {
  count = var.github_repository_url != "" ? 1 : 0

  name       = "${local.name_prefix}-frontend"
  repository = var.github_repository_url
  platform   = "WEB_COMPUTE"

  # OAuth token for GitHub access (stored in variables, not hardcoded)
  access_token = var.github_access_token

  # Environment variables for the frontend
  # Frontend reads NEXT_PUBLIC_LOCAL_API_BASE (not VITE_ prefix)
  environment_variables = {
    NEXT_PUBLIC_LOCAL_API_BASE = aws_api_gateway_stage.main.invoke_url
    NEXT_PUBLIC_AWS_REGION     = var.aws_region
  }

  # Enable auto branch creation for feature branches (optional)
  enable_auto_branch_creation = var.amplify_auto_branch_creation

  # Auto branch creation patterns
  auto_branch_creation_patterns = var.amplify_auto_branch_patterns

  # Auto branch creation config
  auto_branch_creation_config {
    enable_auto_build           = true
    enable_pull_request_preview = var.amplify_enable_pr_preview
  }

  tags = {
    Name = "${local.name_prefix}-frontend"
  }
}

# -----------------------------------------------------------------------------
# Branch: Main (Production)
# -----------------------------------------------------------------------------

resource "aws_amplify_branch" "main" {
  count = var.github_repository_url != "" ? 1 : 0

  app_id      = aws_amplify_app.frontend[0].id
  branch_name = "main"

  display_name = "production"

  # Enable auto build on push
  enable_auto_build = true

  # Framework detection
  framework = "Next.js - SSR"

  # Stage designation
  stage = "PRODUCTION"

  # Environment variables specific to production branch
  environment_variables = {
    NEXT_PUBLIC_ENVIRONMENT = "production"
  }

  tags = {
    Name = "${local.name_prefix}-frontend-main"
  }
}

# -----------------------------------------------------------------------------
# Branch: Staging
# -----------------------------------------------------------------------------

resource "aws_amplify_branch" "staging" {
  count = var.github_repository_url != "" ? 1 : 0

  app_id      = aws_amplify_app.frontend[0].id
  branch_name = "staging"

  display_name = "staging"

  enable_auto_build = true
  framework         = "Next.js - SSR"
  stage             = "BETA"

  environment_variables = {
    NEXT_PUBLIC_ENVIRONMENT = "staging"
  }

  tags = {
    Name = "${local.name_prefix}-frontend-staging"
  }
}

# -----------------------------------------------------------------------------
# Custom Domain (Optional)
# -----------------------------------------------------------------------------

resource "aws_amplify_domain_association" "main" {
  count = var.github_repository_url != "" && var.amplify_domain_name != "" ? 1 : 0

  app_id      = aws_amplify_app.frontend[0].id
  domain_name = var.amplify_domain_name

  # Production subdomain (www.example.com -> main branch)
  sub_domain {
    branch_name = aws_amplify_branch.main[0].branch_name
    prefix      = "www"
  }

  # Apex domain (example.com -> main branch)
  sub_domain {
    branch_name = aws_amplify_branch.main[0].branch_name
    prefix      = ""
  }

  # Staging subdomain (staging.example.com -> staging branch)
  sub_domain {
    branch_name = aws_amplify_branch.staging[0].branch_name
    prefix      = "staging"
  }
}
