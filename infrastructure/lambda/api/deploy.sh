#!/bin/bash

# Deploy Python Lambda API Function
# Uses the same pg8000 layer as docupop-login-backend

set -e

# Configuration
AWS_REGION="${AWS_REGION:-us-west-1}"
FUNCTION_NAME="docupop-api"
ROLE_ARN="arn:aws:iam::171158266543:role/docupop-lambda-execution-role"
SUBNET_IDS="subnet-039386e32cddb38bc,subnet-0a53987a8e2ebbacd"
SECURITY_GROUP_ID="sg-091e057a0ffbe43d3"  # Same as RDS
LAYER_ARN="arn:aws:lambda:us-west-1:171158266543:layer:docupop-pg8000:1"

echo "🚀 Deploying DocuPop API Lambda Function (Python)"
echo ""

# Step 1: Create deployment package
echo "📦 Creating deployment package..."
cd "$(dirname "$0")"
rm -f lambda-api.zip
# Use PowerShell to create ZIP (works on Windows)
powershell.exe -Command "Compress-Archive -Path handler.py -DestinationPath lambda-api.zip -Force"

echo "✅ Package created: lambda-api.zip ($(du -h lambda-api.zip | cut -f1))"

# Step 2: Check if function exists
echo "🔍 Checking if Lambda function exists..."
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$AWS_REGION" >/dev/null 2>&1; then
    echo "📝 Updating existing function..."
    aws lambda update-function-code \
        --function-name "$FUNCTION_NAME" \
        --zip-file fileb://lambda-api.zip \
        --region "$AWS_REGION"

    echo "⏳ Waiting for function update..."
    aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$AWS_REGION"

    echo "⚙️  Updating function configuration..."
    aws lambda update-function-configuration \
        --function-name "$FUNCTION_NAME" \
        --runtime python3.12 \
        --handler handler.handler \
        --timeout 30 \
        --memory-size 512 \
        --layers "$LAYER_ARN" \
        --environment file://env-vars.json \
        --region "$AWS_REGION"
else
    echo "🆕 Creating new function..."
    aws lambda create-function \
        --function-name "$FUNCTION_NAME" \
        --runtime python3.12 \
        --role "$ROLE_ARN" \
        --handler handler.handler \
        --zip-file fileb://lambda-api.zip \
        --timeout 30 \
        --memory-size 512 \
        --layers "$LAYER_ARN" \
        --vpc-config "SubnetIds=$SUBNET_IDS,SecurityGroupIds=$SECURITY_GROUP_ID" \
        --environment file://env-vars.json \
        --region "$AWS_REGION"
fi

echo ""
echo "✅ Lambda function deployed successfully!"
echo ""
echo "Function: $FUNCTION_NAME"
echo "Region: $AWS_REGION"
echo "Runtime: Python 3.12"
echo "Layer: $LAYER_ARN"
echo ""
echo "API Gateway URL: https://79x87qlqx6.execute-api.us-west-1.amazonaws.com"
echo ""
