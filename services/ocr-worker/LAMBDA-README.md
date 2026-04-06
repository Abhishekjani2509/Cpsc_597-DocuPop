# Lambda OCR Worker

AWS Lambda function for processing documents using AWS Textract.

## Architecture

- **Runtime**: Python 3.11 (Container Image)
- **OCR Engine**: AWS Textract
- **Trigger**: Amazon SQS
- **Database**: Aurora PostgreSQL (via VPC)
- **Storage**: Amazon S3

## Files

- `lambda_handler.py` - Lambda entry point, receives SQS messages
- `textract_ocr.py` - AWS Textract integration
- `requirements-lambda.txt` - Python dependencies
- `Dockerfile.lambda` - Container image definition
- `deploy-lambda.sh` - Deployment script

## Environment Variables

The Lambda function requires these environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `AWS_REGION` | AWS region | `us-west-1` (auto-set) |
| `DATABASE_SECRET_ARN` | ARN of Secrets Manager secret with DB credentials | `arn:aws:secretsmanager:us-west-1:123456789012:secret:docupop-db-xxxxx` |
| `S3_BUCKET_NAME` | S3 bucket for document storage | `docupop-documents-staging` |

## Database Secret Format

The `DATABASE_SECRET_ARN` secret must contain:

```json
{
  "host": "docupop.cluster-xxxxx.us-west-1.rds.amazonaws.com",
  "port": 5432,
  "username": "docupop_master",
  "password": "your-password",
  "dbname": "postgres"
}
```

## IAM Permissions

The Lambda execution role needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "textract:DetectDocumentText",
        "textract:AnalyzeDocument"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::docupop-documents-*/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:*:*:secret:docupop-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:*:*:docupop-ocr-queue*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ec2:CreateNetworkInterface",
        "ec2:DescribeNetworkInterfaces",
        "ec2:DeleteNetworkInterface",
        "ec2:AssignPrivateIpAddresses",
        "ec2:UnassignPrivateIpAddresses"
      ],
      "Resource": "*"
    }
  ]
}
```

## Deployment

### Prerequisites

1. AWS CLI installed and configured
2. Docker installed
3. Set environment variables:
   ```bash
   export AWS_ACCOUNT_ID=123456789012
   export AWS_REGION=us-west-1
   ```

### Deploy

```bash
cd services/ocr-worker
chmod +x deploy-lambda.sh
./deploy-lambda.sh
```

This script will:
1. Create ECR repository (if not exists)
2. Build Docker image
3. Push to ECR
4. Update Lambda function (if exists)

### Create Lambda Function (First Time)

If the Lambda function doesn't exist yet, create it:

```bash
aws lambda create-function \
  --function-name docupop-ocr-worker \
  --package-type Image \
  --code ImageUri=123456789012.dkr.ecr.us-west-1.amazonaws.com/docupop-ocr-worker:latest \
  --role arn:aws:iam::123456789012:role/docupop-lambda-execution-role \
  --timeout 900 \
  --memory-size 1536 \
  --environment Variables="{
    DATABASE_SECRET_ARN=arn:aws:secretsmanager:us-west-1:123456789012:secret:docupop-db-xxxxx,
    S3_BUCKET_NAME=docupop-documents-staging
  }" \
  --vpc-config SubnetIds=subnet-xxxxx,subnet-yyyyy,SecurityGroupIds=sg-xxxxx \
  --region us-west-1
```

### Add SQS Trigger

```bash
aws lambda create-event-source-mapping \
  --function-name docupop-ocr-worker \
  --event-source-arn arn:aws:sqs:us-west-1:123456789012:docupop-ocr-queue \
  --batch-size 10 \
  --maximum-batching-window-in-seconds 5 \
  --region us-west-1
```

## Configuration

### Recommended Settings

- **Memory**: 1536 MB (Textract API calls + field extraction)
- **Timeout**: 900 seconds (15 minutes max for Lambda)
- **Batch Size**: 10 (process up to 10 documents per invocation)
- **Reserved Concurrency**: 5-10 (limit concurrent executions)
- **Retry Attempts**: 3 (SQS default, then moves to DLQ)

### VPC Configuration

The Lambda must be in a VPC to access Aurora PostgreSQL:

- **Subnets**: Use private subnets with NAT Gateway
- **Security Group**: Allow outbound to:
  - Aurora (port 5432)
  - S3 (port 443)
  - Textract (port 443)
  - Secrets Manager (port 443)

## Testing

### Local Testing (without Lambda)

```python
# Test Textract OCR locally
import textract_ocr

result = textract_ocr.process_document_from_s3(
    bucket='docupop-documents-staging',
    key='uploads/test-invoice.pdf',
    target_table=None,
    document_name='test-invoice.pdf'
)

print(f"Extracted {len(result['fields'])} fields")
print(f"Confidence: {result['confidence']:.2f}")
```

### Lambda Testing (with AWS CLI)

```bash
# Create test event
cat > test-event.json <<EOF
{
  "Records": [
    {
      "body": "{\"jobId\":\"test-123\",\"documentId\":1,\"userId\":\"user-456\",\"storageKey\":\"uploads/test.pdf\",\"filename\":\"test.pdf\",\"contentType\":\"application/pdf\"}"
    }
  ]
}
EOF

# Invoke Lambda
aws lambda invoke \
  --function-name docupop-ocr-worker \
  --payload file://test-event.json \
  --region us-west-1 \
  response.json

cat response.json
```

## Monitoring

### CloudWatch Metrics

Key metrics to monitor:

- **Invocations**: Number of Lambda invocations
- **Duration**: Execution time (should be < 60 seconds typically)
- **Errors**: Failed invocations
- **Throttles**: Concurrent execution limits reached
- **Iterator Age**: SQS message age (should be near 0)

### CloudWatch Logs

Logs are automatically sent to:
```
/aws/lambda/docupop-ocr-worker
```

### Alarms

Create CloudWatch alarms for:

```bash
# Error rate > 5%
aws cloudwatch put-metric-alarm \
  --alarm-name docupop-lambda-errors \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=FunctionName,Value=docupop-ocr-worker

# Duration > 10 minutes
aws cloudwatch put-metric-alarm \
  --alarm-name docupop-lambda-duration \
  --metric-name Duration \
  --namespace AWS/Lambda \
  --statistic Maximum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 600000 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=FunctionName,Value=docupop-ocr-worker
```

## Troubleshooting

### "Unable to import module 'lambda_handler'"

- Check that `lambda_handler.py` and `textract_ocr.py` are in the image
- Verify CMD in Dockerfile: `CMD ["lambda_handler.lambda_handler"]`

### "AccessDeniedException: User is not authorized to perform: textract:DetectDocumentText"

- Check IAM role has Textract permissions
- Verify execution role is attached to Lambda

### "Connection refused to database"

- Check Lambda is in correct VPC subnets
- Verify security group allows outbound to Aurora (port 5432)
- Check Aurora security group allows inbound from Lambda security group

### "S3 key not found"

- Verify S3_BUCKET_NAME environment variable is set
- Check storage key format matches what's stored in database
- Verify IAM role has S3:GetObject permission

### "Timeout after 900 seconds"

- Very large PDFs may exceed Lambda timeout
- Consider splitting large documents into smaller batches
- Or use ECS Fargate for very large documents (no timeout limit)

## Cost Estimation

### Per 1000 Documents

Assuming average document:
- 5 pages
- 60 seconds processing time
- 1536 MB memory

**Lambda**: $0.50 (60s × 1000 invocations × $0.0000083 per GB-second)
**Textract**: $1.50 ($0.0015 per page × 5 pages × 1000 docs)
**Total**: ~$2.00 per 1000 documents

### Monthly Cost (1000 docs/day)

- Lambda: $15
- Textract: $45
- Total: **~$60/month**

Significantly cheaper than Tesseract on EC2/ECS (which requires 24/7 compute).

## Migration from Tesseract

The Lambda handler uses the same field extraction logic as the Tesseract worker, but with AWS Textract for OCR:

| Feature | Tesseract (Local) | Textract (Lambda) |
|---------|-------------------|-------------------|
| OCR Engine | Tesseract OSS | AWS Textract |
| Preprocessing | Manual (PIL) | Automatic |
| Accuracy | Good | Excellent |
| Speed | 10-30s per page | 5-10s per page |
| Cost | $0 (local compute) | $0.0015/page |
| Scaling | Limited | Automatic |
| Maintenance | Manual | Managed |

Both systems produce identical output format for seamless switching.
