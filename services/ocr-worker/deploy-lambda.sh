#!/bin/bash

# Deploy Lambda OCR Worker to AWS
# Builds Docker image and pushes to Amazon ECR

set -e  # Exit on error

# Configuration
AWS_REGION="${AWS_REGION:-us-west-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID}"
ECR_REPOSITORY="docupop-ocr-worker"
IMAGE_TAG="${IMAGE_TAG:-latest}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Deploying Lambda OCR Worker${NC}"
echo ""

# Validate AWS_ACCOUNT_ID
if [ -z "$AWS_ACCOUNT_ID" ]; then
    echo -e "${RED}❌ Error: AWS_ACCOUNT_ID environment variable not set${NC}"
    echo "Please set it with: export AWS_ACCOUNT_ID=123456789012"
    exit 1
fi

# ECR registry URL
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE_URI="${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}"

echo -e "${YELLOW}Configuration:${NC}"
echo "  AWS Region: ${AWS_REGION}"
echo "  AWS Account: ${AWS_ACCOUNT_ID}"
echo "  ECR Repository: ${ECR_REPOSITORY}"
echo "  Image Tag: ${IMAGE_TAG}"
echo "  Image URI: ${IMAGE_URI}"
echo ""

# Step 1: Check if ECR repository exists, create if not
echo -e "${GREEN}Step 1: Checking ECR repository...${NC}"
if ! aws ecr describe-repositories --repository-names "${ECR_REPOSITORY}" --region "${AWS_REGION}" >/dev/null 2>&1; then
    echo "  Creating ECR repository: ${ECR_REPOSITORY}"
    aws ecr create-repository \
        --repository-name "${ECR_REPOSITORY}" \
        --region "${AWS_REGION}" \
        --image-scanning-configuration scanOnPush=true \
        --encryption-configuration encryptionType=AES256
    echo -e "${GREEN}  ✅ Repository created${NC}"
else
    echo -e "${GREEN}  ✅ Repository exists${NC}"
fi
echo ""

# Step 2: Authenticate Docker to ECR
echo -e "${GREEN}Step 2: Authenticating Docker to ECR...${NC}"
aws ecr get-login-password --region "${AWS_REGION}" | \
    docker login --username AWS --password-stdin "${ECR_REGISTRY}"
echo -e "${GREEN}  ✅ Authenticated${NC}"
echo ""

# Step 3: Build Docker image
echo -e "${GREEN}Step 3: Building Docker image...${NC}"
docker build \
    -f Dockerfile.lambda \
    -t "${ECR_REPOSITORY}:${IMAGE_TAG}" \
    -t "${IMAGE_URI}" \
    .
echo -e "${GREEN}  ✅ Image built${NC}"
echo ""

# Step 4: Push to ECR
echo -e "${GREEN}Step 4: Pushing image to ECR...${NC}"
docker push "${IMAGE_URI}"
echo -e "${GREEN}  ✅ Image pushed${NC}"
echo ""

# Step 5: Get image digest
echo -e "${GREEN}Step 5: Getting image digest...${NC}"
IMAGE_DIGEST=$(aws ecr describe-images \
    --repository-name "${ECR_REPOSITORY}" \
    --image-ids imageTag="${IMAGE_TAG}" \
    --region "${AWS_REGION}" \
    --query 'imageDetails[0].imageDigest' \
    --output text)
echo "  Image Digest: ${IMAGE_DIGEST}"
echo ""

# Step 6: Update Lambda function (if it exists)
LAMBDA_FUNCTION_NAME="docupop-ocr-worker"
echo -e "${GREEN}Step 6: Updating Lambda function (if exists)...${NC}"
if aws lambda get-function --function-name "${LAMBDA_FUNCTION_NAME}" --region "${AWS_REGION}" >/dev/null 2>&1; then
    echo "  Updating Lambda function: ${LAMBDA_FUNCTION_NAME}"
    aws lambda update-function-code \
        --function-name "${LAMBDA_FUNCTION_NAME}" \
        --image-uri "${IMAGE_URI}" \
        --region "${AWS_REGION}"
    echo -e "${GREEN}  ✅ Lambda function updated${NC}"
else
    echo -e "${YELLOW}  ⚠️  Lambda function not found. Please create it first.${NC}"
    echo "  Use Terraform or AWS Console to create the function."
fi
echo ""

echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""
echo "Image URI: ${IMAGE_URI}"
echo "Image Digest: ${IMAGE_DIGEST}"
echo ""
echo "Next steps:"
echo "  1. Create Lambda function with this image (if not exists)"
echo "  2. Configure environment variables:"
echo "     - DATABASE_SECRET_ARN"
echo "     - S3_BUCKET_NAME"
echo "  3. Configure VPC settings (subnets, security groups)"
echo "  4. Add SQS event source mapping"
