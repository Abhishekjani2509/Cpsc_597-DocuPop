# DocuPop Terraform Infrastructure

This Terraform configuration deploys the complete DocuPop infrastructure on AWS.

## Architecture Overview

```
                                    +-----------------+
                                    |  AWS Amplify    |
                                    |   (Frontend)    |
                                    |  React + Vite   |
                                    +--------+--------+
                                             |
                                             | HTTPS
                                             v
+---------------------------------------------|--------------------------------------------+
|                                    VPC (10.0.0.0/16)                                    |
|                                             |                                            |
|  +------------------+              +--------+--------+              +------------------+ |
|  |  Public Subnet   |              |   API Gateway   |              |  Public Subnet   | |
|  |   10.0.1.0/24    |              |    (REST API)   |              |   10.0.2.0/24    | |
|  +--------+---------+              +--------+--------+              +--------+---------+ |
|           |                                 |                                |           |
|     +-----+-----+                          |                          +-----+-----+     |
|     | NAT GW   |                           |                          | NAT GW   |     |
|     +-----------+                          |                          +-----------+     |
|           |                                 |                                |           |
|  +--------+---------+              +--------+--------+              +--------+---------+ |
|  | Private Subnet   |              |  API Lambda     |              | Private Subnet   | |
|  |   10.0.11.0/24   |<-------------+  (Python 3.11)  +------------->|   10.0.12.0/24   | |
|  +--------+---------+              +--------+--------+              +--------+---------+ |
|           |                                 |                                |           |
|           |                    +------------+------------+                   |           |
|           |                    |            |            |                   |           |
|           v                    v            v            v                   v           |
|  +--------+---------+  +-------+--+  +------+---+  +-----+----+     +--------+---------+ |
|  | Aurora PostgreSQL|  |   S3     |  |   SQS    |  | Cognito  |     | Aurora PostgreSQL| |
|  |  (Serverless v2) |  | (Docs)   |  | (Queue)  |  |  (Auth)  |     |    (Reader)      | |
|  +------------------+  +----------+  +----+-----+  +----------+     +------------------+ |
|                                            |                                             |
|                                    +-------+-------+                                     |
|                                    |  OCR Worker   |                                     |
|                                    |   Lambda      |-----> AWS Textract                  |
|                                    |  (Container)  |                                     |
|                                    +---------------+                                     |
+-----------------------------------------------------------------------------------------+
```

## Prerequisites

1. **AWS CLI** configured with appropriate credentials
2. **Terraform** >= 1.0.0
3. **Docker** (for building OCR worker container)
4. **S3 bucket** for Terraform state (optional but recommended)

## Quick Start

### 1. Initialize Terraform

```bash
cd infrastructure/terraform

# Initialize with local state (development)
terraform init

# Or initialize with S3 backend (recommended for production)
terraform init \
  -backend-config="bucket=your-terraform-state-bucket" \
  -backend-config="key=docupop/terraform.tfstate" \
  -backend-config="region=us-west-1"
```

### 2. Configure Variables

```bash
# Copy example configuration
cp terraform.tfvars.example terraform.tfvars

# Edit with your values
nano terraform.tfvars
```

### 3. Plan and Apply

```bash
# Review what will be created
terraform plan

# Apply the configuration
terraform apply

# Type 'yes' when prompted
```

### 4. Get Outputs

```bash
# View all outputs
terraform output

# Get specific values
terraform output api_gateway_url
terraform output cognito_user_pool_id
```

## Configuration

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `project_name` | Project identifier | `docupop` |
| `environment` | Environment name | `staging`, `production` |
| `aws_region` | AWS region | `us-west-1` |

### Optional Variables

See `terraform.tfvars.example` for complete list with defaults.

## Resources Created

### Networking
- VPC with public and private subnets
- NAT Gateways for Lambda internet access
- Security groups for Lambda and RDS
- VPC Endpoints (S3, SQS, ECR, Secrets Manager, Textract)

### Compute
- **API Lambda**: Handles REST API requests
- **OCR Worker Lambda**: Processes documents via SQS trigger

### Database
- Aurora PostgreSQL Serverless v2 cluster
- Automatic password generation
- Credentials stored in Secrets Manager

### Storage
- S3 bucket for document storage
- ECR repository for OCR worker container

### Messaging
- SQS queue for OCR jobs
- Dead letter queue for failed jobs

### Authentication
- Cognito User Pool
- App client configuration

### API
- API Gateway REST API
- Lambda proxy integration
- CORS configuration

### Frontend (Amplify)
- AWS Amplify App connected to GitHub
- Auto-deploy on push to main/staging branches
- Environment variables automatically configured
- SPA routing with custom rewrite rules

## Environments

Use Terraform workspaces or separate variable files:

```bash
# Using workspaces
terraform workspace new staging
terraform workspace new production
terraform workspace select staging

# Using separate var files
terraform apply -var-file="staging.tfvars"
terraform apply -var-file="production.tfvars"
```

## Updating Lambda Functions

After initial deployment, use these commands to update Lambda code:

### API Lambda

```bash
# Build and deploy
cd services/api-lambda
zip -r ../../api-lambda.zip .
aws lambda update-function-code \
  --function-name docupop-staging-api \
  --zip-file fileb://../../api-lambda.zip \
  --region us-west-1
```

### OCR Worker Lambda

```bash
# Build and push container
cd services/ocr-worker
aws ecr get-login-password --region us-west-1 | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-west-1.amazonaws.com

docker buildx build --platform linux/amd64 \
  -f Dockerfile.lambda \
  -t <account-id>.dkr.ecr.us-west-1.amazonaws.com/docupop-staging-ocr-worker:latest \
  --provenance=false --sbom=false \
  .

docker push <account-id>.dkr.ecr.us-west-1.amazonaws.com/docupop-staging-ocr-worker:latest

# Update Lambda to use new image
aws lambda update-function-code \
  --function-name docupop-staging-ocr-worker \
  --image-uri <account-id>.dkr.ecr.us-west-1.amazonaws.com/docupop-staging-ocr-worker:latest \
  --region us-west-1
```

## Amplify Frontend

Amplify is configured to automatically deploy from GitHub. Environment variables (API URL, Cognito IDs) are automatically injected from Terraform outputs.

### Setup Requirements

1. **GitHub Personal Access Token**: Create a token with `repo` and `admin:repo_hook` scopes
2. **Repository URL**: Your GitHub repository URL

### Configuration

In your `terraform.tfvars`:

```hcl
github_repository_url = "https://github.com/your-username/docupop"
github_access_token   = "ghp_xxxxxxxxxxxxxxxxxxxx"  # Or use environment variable
```

Or use environment variable:
```bash
export TF_VAR_github_access_token="ghp_xxxxxxxxxxxxxxxxxxxx"
```

### Branch Deployments

| Branch | URL | Environment |
|--------|-----|-------------|
| main | `https://main.<app-id>.amplifyapp.com` | Production |
| staging | `https://staging.<app-id>.amplifyapp.com` | Staging |

### Custom Domain (Optional)

Set `amplify_domain_name` to configure a custom domain:

```hcl
amplify_domain_name = "docupop.com"
```

This creates:
- `www.docupop.com` -> main branch
- `docupop.com` -> main branch
- `staging.docupop.com` -> staging branch

### Get Amplify URLs

```bash
terraform output amplify_production_url
terraform output amplify_staging_url
```

## Frontend Configuration (Manual)

If not using Amplify via Terraform, configure your frontend manually:

```bash
# Get values for frontend .env
terraform output frontend_config
```

Create `.env` in your frontend directory:

```env
VITE_API_BASE_URL=https://xxxxxxxxxx.execute-api.us-west-1.amazonaws.com/api
VITE_AWS_REGION=us-west-1
VITE_USER_POOL_ID=us-west-1_xxxxxxxxx
VITE_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Database Access

To connect to the database for debugging:

```bash
# Get credentials from Secrets Manager
aws secretsmanager get-secret-value \
  --secret-id docupop-staging-db-credentials \
  --query SecretString \
  --output text | jq .

# Use bastion host or SSM Session Manager for access
```

## Monitoring

### CloudWatch Logs

- API Lambda: `/aws/lambda/docupop-staging-api`
- OCR Worker: `/aws/lambda/docupop-staging-ocr-worker`
- API Gateway: `/aws/api-gateway/docupop-staging`

### Useful Commands

```bash
# View API Lambda logs
aws logs tail /aws/lambda/docupop-staging-api --follow

# View OCR Worker logs
aws logs tail /aws/lambda/docupop-staging-ocr-worker --follow

# Check SQS queue depth
aws sqs get-queue-attributes \
  --queue-url $(terraform output -raw sqs_queue_url) \
  --attribute-names ApproximateNumberOfMessages
```

## Destroying Infrastructure

```bash
# Preview what will be destroyed
terraform plan -destroy

# Destroy all resources
terraform destroy

# Type 'yes' when prompted
```

**Warning**: This will delete all data including the database and S3 bucket contents.

## State Management

### S3 Backend (Recommended)

Create a state bucket first:

```bash
aws s3 mb s3://docupop-terraform-state-bucket --region us-west-1

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket docupop-terraform-state-bucket \
  --versioning-configuration Status=Enabled
```

Update `main.tf` backend configuration and reinitialize.

### State Locking

For team environments, enable DynamoDB locking:

```bash
aws dynamodb create-table \
  --table-name terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

## Troubleshooting

### Lambda Timeout
- Increase `lambda_api_timeout` or `lambda_ocr_timeout`
- Check VPC configuration and NAT Gateway

### Database Connection Issues
- Verify security group rules
- Check RDS cluster is running
- Validate credentials in Secrets Manager

### Container Push Failures
- Ensure Docker is running
- Check ECR login is current
- Verify IAM permissions

### API Gateway 5XX Errors
- Check Lambda CloudWatch logs
- Verify Lambda execution role permissions
- Test Lambda directly with test event

## Cost Optimization

1. Use Aurora Serverless v2 with low min capacity for dev/staging
2. Consider removing NAT Gateways if VPC endpoints suffice
3. Set S3 lifecycle rules for infrequent access transition
4. Review Lambda memory settings based on actual usage

## Security Considerations

1. Database credentials stored in Secrets Manager
2. All resources in private subnets where possible
3. Security groups follow least privilege
4. S3 bucket blocks public access
5. API Gateway uses HTTPS only
6. Cognito handles user authentication
