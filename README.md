# DocuPop - AI-Powered Document Processing Platform

A cloud-native document management and OCR processing platform built on AWS. DocuPop enables users to upload, organize, and intelligently extract data from documents using **AWS Textract**, storing structured results in user-defined data tables with a Smart Review workflow.

**Built for CPSC-597 (MS Computer Science, Cal State Fullerton)**

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [AWS Cloud Services](#aws-cloud-services)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Features](#features)
- [Database Schema](#database-schema)
- [API Endpoints](#api-endpoints)
- [Prerequisites](#prerequisites)
- [Local Development Setup](#local-development-setup)
- [AWS Deployment Guide](#aws-deployment-guide)
- [Environment Variables](#environment-variables)
- [CI/CD Pipeline](#cicd-pipeline)
- [Teardown](#teardown)
- [Troubleshooting](#troubleshooting)
- [Sample Documents](#sample-documents)

---

## Overview

DocuPop is a full-stack document processing system that combines a modern React frontend with a serverless AWS backend. The complete workflow:

1. **User signs up/logs in** via AWS Cognito authentication
2. **Uploads documents** (PDF, PNG, JPG, TIFF, WEBP) stored in S3
3. **Creates custom data tables** to define what data to extract
4. **Queues OCR processing jobs** sent to SQS with optional Textract adapters and custom queries
5. **OCR Worker Lambda** picks up jobs, uses AWS Textract to extract structured fields
6. **Extracted data** is mapped to user-defined table columns and stored in PostgreSQL with per-field confidence scores
7. **Users review extracted data** via Smart Cards and Review Queue — approving, editing, and exporting results

---

## Architecture

```
                                    +------------------+
                                    |   AWS Amplify    |
                                    |  (Next.js SSR)   |
                                    |   Frontend App   |
                                    +--------+---------+
                                             |
                                             | HTTPS
                                             v
                                    +------------------+
                                    |  API Gateway     |
                                    |  (REST API)      |
                                    |  Regional HTTPS  |
                                    +--------+---------+
                                             |
                                             | Lambda Proxy
                                             v
                              +-----------------------------+
                              |     API Lambda (Python)     |
                              |                             |
                              |  - Auth (Cognito JWT)       |
                              |  - Documents CRUD           |
                              |  - Data Tables CRUD         |
                              |  - Processing Jobs          |
                              |  - Textract Adapters List   |
                              +----+----------+--------+----+
                                   |          |        |
                          +--------+    +-----+--+   +-+--------+
                          |             |        |   |           |
                          v             v        v   v           v
                    +---------+   +--------+ +-----+---+  +-----------+
                    |   RDS   |   |   S3   | |   SQS   |  |  Cognito  |
                    |PostgreSQL|  | Bucket | |  Queue  |  | User Pool |
                    | (Private |  |        | |         |  |           |
                    |  Subnet) |  +--------+ +----+----+  +-----------+
                    +---------+                   |
                                                  | Triggers
                                                  v
                                         +--------------------+
                                         | OCR Worker Lambda  |
                                         | (Container/ECR)    |
                                         |                    |
                                         | Textract us-west-1 |
                                         | Textract us-east-1 |
                                         | (adapter calls)    |
                                         +--------------------+
```

### Network Architecture

```
VPC (10.0.0.0/16)
├── Public Subnets (2 AZs)
│   ├── Internet Gateway
│   ├── NAT Gateway + Elastic IP
│   └── Public route table
└── Private Subnets (2 AZs)
    ├── RDS PostgreSQL instance
    ├── API Lambda function
    ├── OCR Worker Lambda function
    └── Private route table (via NAT)
```

Both Lambda functions run inside the VPC private subnets so they can access RDS directly. Outbound internet access (for AWS API calls like S3, SQS, Cognito, Textract) is provided through the NAT Gateway.

---

## AWS Cloud Services

DocuPop uses the following AWS services, all provisioned via Terraform:

### 1. AWS Amplify (Frontend Hosting)
- **Purpose**: Hosts the Next.js 15 SSR application
- **Platform**: `WEB_COMPUTE` (supports server-side rendering)
- **Auto-deploy**: Connected to GitHub repository; builds on every push to `main`
- **Build process**: Installs dependencies, injects environment variables into `.env.production`, builds Next.js app

### 2. Amazon API Gateway (REST API)
- **Purpose**: HTTPS entry point for all backend API calls
- **Type**: Regional REST API
- **Routing**: Catch-all `{proxy+}` resource forwards all requests to the API Lambda
- **CORS**: Preflight OPTIONS handled via MOCK integration with dynamic origin support

### 3. AWS Lambda - API Handler
- **Purpose**: Main backend logic — handles all HTTP requests
- **Runtime**: Python 3.11
- **Memory**: 512 MB
- **Timeout**: 30 seconds
- **Deployment**: ZIP package (handler + all Python dependencies)
- **Responsibilities**: Authentication, document management, data tables, processing jobs, Textract adapter listing

### 4. AWS Lambda - OCR Worker
- **Purpose**: Processes OCR jobs asynchronously
- **Runtime**: Container image (Python 3.11 base)
- **Memory**: 1536 MB
- **Timeout**: 900 seconds (15 minutes)
- **Trigger**: SQS queue (batch size 10, max concurrency 10)
- **OCR Engine**: AWS Textract (`AnalyzeDocument` with optional custom queries and adapters)
- **Dual-region Textract**: Default client in `us-west-1` for standard OCR; dedicated `us-east-1` client for adapter calls (adapters only exist in us-east-1). When an adapter is used, document bytes are downloaded from S3 and passed directly to Textract to avoid cross-region S3 access issues.

### 5. Amazon RDS (PostgreSQL)
- **Purpose**: Primary database for all application data
- **Engine**: PostgreSQL 15.12
- **Instance**: `db.t3.micro` (staging)
- **Location**: Private subnets (not publicly accessible)
- **Credentials**: Managed via AWS Secrets Manager
- **Features**: Automated backups, configurable deletion protection

### 6. Amazon S3 (Document Storage)
- **Purpose**: Stores uploaded documents (PDFs, images)
- **Access**: Private bucket, no public access
- **Encryption**: AES-256 server-side encryption
- **Access Pattern**: Presigned URLs generated by Lambda for upload/download/view
- **Key Format**: `uploads/{user_id}/{timestamp}_{filename}`
- **Lifecycle Rules**:
  - Abort incomplete multipart uploads after 7 days
  - Transition to Infrequent Access after 90 days
  - Delete old versions after 30 days

### 7. Amazon SQS (Job Queue)
- **Purpose**: Decouples OCR job submission from processing
- **Main Queue**: `docupop-staging-ocr-jobs`
- **Dead Letter Queue**: `docupop-staging-ocr-jobs-dlq` (after 3 failed attempts)
- **Long Polling**: 20-second wait time
- **Retention**: 4 days
- **Visibility Timeout**: 900 seconds (matches Lambda timeout)

### 8. Amazon Cognito (Authentication)
- **Purpose**: User registration, login, and JWT token management
- **Authentication**: Email-based sign up/sign in
- **Password Policy**: Minimum 8 characters, requires uppercase, lowercase, and numbers
- **MFA**: Optional TOTP (Time-based One-Time Password) via authenticator apps
- **Token Flow**: Frontend obtains JWT from Cognito → sends as `Authorization: Bearer <token>` → Lambda validates token
- **Multi-tenancy**: Each user identified by Cognito `sub` (UUID), all data queries filtered by user ID

### 9. Amazon ECR (Container Registry)
- **Purpose**: Stores Docker images for the OCR Worker Lambda
- **Scanning**: Image vulnerability scanning on push
- **Lifecycle**: Keeps last 10 images, auto-deletes older ones

### 10. Amazon CloudWatch (Logging & Monitoring)
- **Log Groups**:
  - `/aws/lambda/docupop-staging-api` — API Lambda logs
  - `/aws/lambda/docupop-staging-ocr-worker` — OCR Worker logs
  - `/aws/api-gateway/docupop-staging` — API Gateway access logs
- **Retention**: 14 days

### 11. AWS IAM (Permissions)
- **Lambda Execution Role**: Permissions for S3, SQS, RDS, Secrets Manager, CloudWatch, VPC, Cognito, Textract
- **Principle of Least Privilege**: Each service has only the permissions it needs

### 12. AWS Secrets Manager
- **Purpose**: Stores RDS database credentials securely
- **Access**: Only Lambda functions can read the secret via IAM policy

### 13. VPC & Networking
- **VPC**: `10.0.0.0/16` CIDR block
- **Public Subnets**: 2 subnets across 2 AZs (NAT Gateway, Internet Gateway)
- **Private Subnets**: 2 subnets across 2 AZs (RDS, Lambda functions)
- **NAT Gateway**: Allows private subnet resources to reach the internet

---

## Tech Stack

### Frontend
| Technology | Version | Purpose |
|---|---|---|
| Next.js | 15.3.1 | React framework with App Router & SSR |
| React | 19.2.1 | UI library |
| TypeScript | 5.x | Type safety |
| Tailwind CSS | 3.4.17 | Utility-first CSS framework |
| AG Grid | 33.0.3 | Interactive data table grid |
| Radix UI | Latest | Accessible UI primitives |
| Lucide React | 0.468.0 | Icon library |
| Sonner | 2.0.7 | Toast notifications |
| PapaParse | 5.5.3 | CSV parsing for data import |
| AWS SDK v3 | 3.709.0 | S3, Cognito, SQS, Textract, Secrets Manager |

### Backend
| Technology | Version | Purpose |
|---|---|---|
| Python | 3.11 | Lambda runtime |
| pg8000 | Latest | Pure Python PostgreSQL driver (API Lambda) |
| boto3 | Latest | AWS SDK for Python |
| psycopg2 | Latest | PostgreSQL driver (OCR Worker) |

### Infrastructure
| Technology | Version | Purpose |
|---|---|---|
| Terraform | 1.0+ | Infrastructure as Code |
| Docker | Latest | Container builds for OCR worker |
| GitHub Actions | — | CI/CD pipeline |
| AWS CLI | v2 | AWS resource management |

---

## Project Structure

```
DocuPop/
├── app/                                    # Next.js App Router
│   ├── layout.tsx                          # Root layout (AuthProvider + NavBar)
│   ├── page.tsx                            # Landing/home page
│   ├── upload/
│   │   └── page.tsx                        # Document upload interface
│   ├── documents/
│   │   └── page.tsx                        # Document listing & management
│   ├── processing/
│   │   └── page.tsx                        # OCR processing center
│   ├── adapters/
│   │   └── page.tsx                        # Textract custom adapters management
│   ├── data/
│   │   └── page.tsx                        # Data Hub: tables, rows, cards, review queue
│   ├── api/                                # Next.js API routes (proxy to Lambda)
│   │   ├── auth/                           # Auth endpoints (signup, login, logout, MFA, etc.)
│   │   ├── documents/                      # Document CRUD + presigned URLs
│   │   ├── processing/                     # OCR job management
│   │   └── data/tables/                    # Table, row, mapping, field, import endpoints
│   └── globals.css
│
├── components/
│   ├── AuthProvider.tsx                    # Authentication context provider
│   ├── NavBar.tsx                          # Navigation bar
│   ├── FileUpload.tsx                      # Drag-and-drop file upload
│   ├── auth/                               # Login, SignUp, MFA forms
│   └── ui/                                 # Reusable UI primitives (button, card, input, etc.)
│
├── lib/
│   ├── api.ts                              # Centralized API client + TypeScript interfaces
│   ├── auth-service.ts                     # Authentication service
│   └── utils.ts                            # Utility functions
│
├── server/                                 # Server-side logic
│   ├── config.ts
│   ├── db.ts
│   ├── data-store.ts
│   ├── data-tables.ts
│   ├── processing-store.ts
│   ├── storage-service.ts
│   ├── sqs-service.ts
│   └── auth/
│
├── infrastructure/
│   ├── terraform/                          # All AWS resources as Terraform IaC
│   │   ├── main.tf, variables.tf, outputs.tf
│   │   ├── vpc.tf, rds.tf, s3.tf, sqs.tf
│   │   ├── lambda-api.tf, lambda-ocr.tf
│   │   ├── ecr.tf, cognito.tf, api-gateway.tf
│   │   ├── iam.tf, amplify.tf, cloudwatch.tf
│   │   └── terraform.tfvars.example
│   └── lambda/api/
│       └── handler.py                      # API Lambda handler (all routes)
│
├── services/ocr-worker/
│   ├── lambda_handler.py                   # SQS event handler
│   ├── textract_ocr.py                     # Textract integration (dual-region client)
│   ├── Dockerfile.lambda                   # Container image (linux/amd64)
│   ├── requirements-lambda.txt
│   └── deploy-lambda.sh
│
├── sample-docs/                            # 15 sample documents (5 per type × 3 types)
│   ├── employee-sample-pdf.pdf
│   ├── employee-sample-jpg.jpg
│   ├── employee-sample-png.png
│   ├── employee-sample-tiff.tiff
│   ├── employee-sample-webp.webp
│   ├── invoice-sample-pdf.pdf
│   ├── invoice-sample-jpg.jpg
│   ├── invoice-sample-png.png
│   ├── invoice-sample-tiff.tiff
│   ├── invoice-sample-webp.webp
│   ├── patient-sample-pdf.pdf
│   ├── patient-sample-jpg.jpg
│   ├── patient-sample-png.png
│   ├── patient-sample-tiff.tiff
│   └── patient-sample-webp.webp
│
├── package.json
├── tsconfig.json
├── next.config.js
├── tailwind.config.ts
└── .gitignore
```

---

## Features

### 1. User Authentication
- Email + password registration and login via AWS Cognito
- JWT-based auth with automatic token refresh
- Optional TOTP multi-factor authentication
- Forgot/reset password flow
- Full multi-tenancy — all data isolated by Cognito user ID

### 2. Document Management
- Drag-and-drop or click-to-upload interface
- **Supported formats**: PDF, PNG, JPG/JPEG, TIFF, WEBP
- Secure storage in private S3 bucket (AES-256 encryption)
- In-browser document viewer and secure download via presigned URLs
- Delete removes document from both S3 and database

### 3. OCR Processing
- Submit documents for asynchronous OCR via SQS
- **AWS Textract** production OCR engine with per-field confidence scoring
- **Custom Adapters**: Select a trained Textract custom adapter for specialized document types (invoices, employee records, patient forms, etc.)
- **Default queries from adapter**: Adapter descriptions encode default queries (`queries:Field1|Field2|...`) which auto-populate the query list when the adapter is selected
- **Custom queries**: Define targeted extraction queries for specific fields beyond what the adapter provides
- **Dual-region Textract**: Standard OCR uses `us-west-1`; adapter calls use a dedicated `us-east-1` client with document bytes passed directly (avoids cross-region S3 restrictions)
- **Auto-mapping**: Extracted fields automatically mapped to target table columns via field mappings
- Real-time job status tracking (pending → processing → completed/failed)
- Dead Letter Queue after 3 failed attempts

### 4. Textract Custom Adapters
- List all trained adapters from your AWS account (`us-east-1`)
- View adapter name, version, status, and creation date
- Adapter description encodes default queries: set description to `queries:FirstName|LastName|Total` and they auto-populate in the Processing page when the adapter is selected

### 5. Data Hub (Tables & Review)
- **Custom table schemas**: Define tables with named columns
- **CSV Import**: Upload CSV files to auto-create columns and import rows (all imported rows are auto-approved)
- **Field Mappings**: Map OCR extraction labels to table columns for deterministic ingestion
- **Add Fields**: Add new columns to existing tables at any time

#### Three-View Data Interface

**Table View** — AG Grid spreadsheet with:
  - Inline cell editing with save-on-change
  - Confidence bars embedded in each cell (color-coded: green ≥90%, amber ≥70%, red <70%)
  - Toggle confidence columns on/off
  - Quick search across all columns
  - Zoom in/out (30%–150%) and fit-all-columns
  - Pagination (25/50/100/200 rows)
  - CSV export

**Cards View** — Document cards with:
  - Type-aware styling (blue for employees, green for invoices, purple for patients)
  - Per-field confidence percentage + colored dot
  - Low-confidence fields highlighted in red
  - Inline edit mode with save/cancel
  - Approve button (only shown on rows with fields below 80% confidence)

**Review Queue** — Focused review workflow:
  - Shows only rows where at least one field has confidence < 80%
  - Badge on the Review tab shows pending count
  - Approved section shows already-reviewed rows
  - Inline edit → auto-approves on save

#### Auto-Approval Logic
- **CSV-imported rows**: Auto-approved on load (no confidence scores)
- **High-confidence rows**: Auto-approved on load if all fields ≥ 80%
- **Approval persists**: Stored in `localStorage` — survives page refresh

### 6. Processing Workflow
```
User submits OCR job (document + table + adapter + queries)
       ↓
API Lambda creates job record (status: pending) + sends SQS message
       ↓
OCR Worker Lambda triggered by SQS
       ↓
If adapter: download doc bytes from S3 → send to Textract us-east-1
If no adapter: send S3 reference to Textract us-west-1
       ↓
Textract returns blocks with confidence scores
       ↓
Fields matched to target table schema via mappings
       ↓
Results stored in data_rows as JSONB {field: {value, confidence}}
       ↓
Job status → "completed"
       ↓
User reviews in Data Hub (Cards / Review Queue)
```

---

## Database Schema

The database is automatically initialized by the API Lambda on first request.

### users
| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key (matches Cognito sub) |
| email | TEXT | Unique email address |
| name | TEXT | Display name |
| created_at | TIMESTAMPTZ | Account creation time |

### documents
| Column | Type | Description |
|---|---|---|
| id | SERIAL | Auto-increment primary key |
| user_id | UUID | Foreign key → users |
| filename | TEXT | Original filename |
| stored_filename | TEXT | S3 object key |
| file_size | INTEGER | File size in bytes |
| content_type | TEXT | MIME type |
| created_at | TIMESTAMPTZ | Upload time |

### data_tables
| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| user_id | UUID | Foreign key → users |
| name | TEXT | Table name |
| description | TEXT | Optional description |
| created_at | TIMESTAMPTZ | Creation time |

### data_fields
| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| table_id | UUID | Foreign key → data_tables |
| name | TEXT | Field/column name |
| data_type | TEXT | text, number, date |
| position | INTEGER | Column display order |

### data_rows
| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| table_id | UUID | Foreign key → data_tables |
| data | JSONB | `{field_name: {value, confidence}}` |
| created_at | TIMESTAMPTZ | Creation time |
| updated_at | TIMESTAMPTZ | Last update time |

### data_field_mappings
| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| table_id | UUID | Foreign key → data_tables |
| source_label | TEXT | OCR label to match |
| target_field | TEXT | Target table column |
| matcher | TEXT | Matching strategy (default: `contains`) |

### processing_jobs
| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| user_id | UUID | Foreign key → users |
| document_id | INTEGER | Foreign key → documents |
| status | TEXT | pending / processing / completed / failed |
| engine | TEXT | textract or tesseract |
| result | JSONB | OCR extraction results |
| confidence | NUMERIC | Overall confidence score |
| error | TEXT | Error message if failed |
| target_table_id | UUID | Target table for auto-mapping |
| created_at / updated_at / started_at / completed_at | TIMESTAMPTZ | Timestamps |

---

## API Endpoints

**Base URL**: `https://<api-gateway-id>.execute-api.us-west-1.amazonaws.com/api`

All endpoints except auth require `Authorization: Bearer <JWT>`.

### Authentication
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/signup` | Create new account |
| POST | `/api/auth/login` | Login and get JWT |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Get current user profile |
| POST | `/api/auth/refresh` | Refresh JWT token |
| POST | `/api/auth/forgot-password` | Request password reset |
| POST | `/api/auth/reset-password` | Complete password reset |
| POST | `/api/auth/mfa/setup` | Get MFA secret/QR code |
| POST | `/api/auth/mfa/verify` | Verify MFA code |

### Documents
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/documents` | List all user documents |
| POST | `/api/documents` | Upload a document |
| GET | `/api/documents/{id}` | Get document metadata |
| DELETE | `/api/documents/{id}` | Delete document (S3 + DB) |
| GET | `/api/documents/{id}/download` | Presigned download URL |
| GET | `/api/documents/{id}/view` | Presigned view URL |

### Textract Adapters
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/textract/adapters` | List available custom adapters (calls `get_adapter` per adapter to include description + default queries) |

### Data Tables
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/data/tables` | List all tables |
| POST | `/api/data/tables` | Create a new table |
| GET | `/api/data/tables/{id}` | Get table with fields |
| PUT | `/api/data/tables/{id}` | Update table |
| DELETE | `/api/data/tables/{id}` | Delete table |
| POST | `/api/data/tables/{id}/fields` | Add a field to a table |

### Data Rows
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/data/tables/{id}/rows` | List all rows |
| POST | `/api/data/tables/{id}/rows` | Insert rows |
| GET | `/api/data/tables/{id}/rows/{rowId}` | Get single row |
| PUT | `/api/data/tables/{id}/rows/{rowId}` | Update row |
| DELETE | `/api/data/tables/{id}/rows/{rowId}` | Delete row |

### Field Mappings & Import
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/data/tables/{id}/mappings` | List field mappings |
| POST | `/api/data/tables/{id}/mappings` | Create mapping |
| DELETE | `/api/data/tables/{id}/mappings/{mid}` | Delete mapping |
| POST | `/api/data/tables/{id}/import` | Import CSV data |

### Processing Jobs
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/processing` | Submit OCR job |
| GET | `/api/processing/{id}` | Get job status |
| GET | `/api/processing/jobs/next` | Worker: fetch next job |
| POST | `/api/processing/jobs/{id}` | Worker: update job status |

### Health
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | API health check |

---

## Prerequisites

- **Node.js** 18+ and **npm**
- **AWS Account** with IAM credentials (admin permissions)
- **AWS CLI v2** configured (`aws configure`)
- **Terraform** 1.0+
- **Docker** (for OCR worker container builds — must support `linux/amd64`)

---

## Local Development Setup

### 1. Clone & Install

```bash
git clone https://github.com/Abhishekjani2509/Cpsc_597-DocuPop.git
cd Cpsc_597-DocuPop
npm install
```

### 2. Configure Environment

Create `.env.local`:

```env
NEXT_PUBLIC_LOCAL_API_BASE=https://<api-id>.execute-api.us-west-1.amazonaws.com/api
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-west-1_XXXXXXXXX
NEXT_PUBLIC_COGNITO_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
NEXT_PUBLIC_AWS_REGION=us-west-1
```

### 3. Run Development Server

```bash
npm run dev
# → http://localhost:3000 (connects to live AWS backend)
```

---

## AWS Deployment Guide

### Step 1: Terraform Infrastructure

```bash
cd infrastructure/terraform
terraform init
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

export TF_VAR_github_access_token="ghp_your_pat"
terraform plan
terraform apply   # ~10-15 minutes, ~62 resources
terraform output  # save the outputs
```

Key outputs: `api_gateway_id`, `cognito_user_pool_id`, `cognito_client_id`, `ecr_repository_url`

### Step 2: Deploy API Lambda

```bash
cd infrastructure/lambda/api
pip install pg8000 scramp asn1crypto -t .
zip -r /tmp/api-lambda.zip .
aws lambda update-function-code \
  --function-name docupop-staging-api \
  --zip-file fileb:///tmp/api-lambda.zip \
  --region us-west-1
```

> **Important**: Zip the entire directory (not just `handler.py`) to include all Python dependencies.

### Step 3: Deploy OCR Worker

```bash
cd services/ocr-worker

# Build for Lambda (must be linux/amd64, not ARM)
docker buildx build --platform linux/amd64 \
  -f Dockerfile.lambda \
  -t <ecr-url>:latest \
  --provenance=false --sbom=false .

aws ecr get-login-password --region us-west-1 | \
  docker login --username AWS --password-stdin <ecr-url>

docker push <ecr-url>:latest

aws lambda update-function-code \
  --function-name docupop-staging-ocr-worker \
  --image-uri <ecr-url>:latest \
  --region us-west-1
```

### Step 4: Amplify Frontend

Amplify is configured by Terraform and auto-deploys on every push to `main`. After the first `terraform apply`, trigger the initial build:

```bash
aws amplify start-job \
  --app-id <amplify-app-id> \
  --branch-name main \
  --job-type RELEASE \
  --region us-west-1
```

Frontend URL: `https://production.<app-id>.amplifyapp.com`

### Step 5: Update CORS Origins

After getting your Amplify URL, update `handler.py` (defaults list), `api-gateway.tf`, and `terraform.tfvars` with the Amplify domain, then redeploy Lambda and run `terraform apply`.

---

## Environment Variables

### Frontend (`.env.local` / Amplify)
| Variable | Description |
|---|---|
| `NEXT_PUBLIC_LOCAL_API_BASE` | API Gateway base URL |
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | Cognito User Pool ID |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | Cognito App Client ID |
| `NEXT_PUBLIC_AWS_REGION` | AWS region |

### API Lambda (set by Terraform)
`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `S3_BUCKET`, `SQS_QUEUE_URL`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `ALLOWED_ORIGINS`, `AWS_REGION`

### OCR Worker Lambda (set by Terraform)
`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_SECRET_ARN`, `S3_BUCKET`, `SQS_QUEUE_URL`, `AWS_REGION`

---

## CI/CD Pipeline

Amplify auto-deploys the frontend on every push to `main`. GitHub Actions handles Lambda and infrastructure updates:

1. **Frontend CI**: `npm ci` → lint → `npm run build`
2. **API Lambda**: Package → `aws lambda update-function-code`
3. **OCR Worker**: Docker build → ECR push → Lambda update
4. **Infrastructure**: `terraform plan` / `terraform apply`

### Required GitHub Secrets
| Secret | Description |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM user access key |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key |

---

## Teardown

```bash
cd infrastructure/terraform
export TF_VAR_github_access_token="<your-pat>"
terraform destroy
```

If ECR deletion fails (non-empty repository):
```bash
aws ecr delete-repository \
  --repository-name docupop-staging-ocr-worker \
  --force --region us-west-1
```

If Secrets Manager deletion fails:
```bash
aws secretsmanager delete-secret \
  --secret-id "docupop-staging/database-credentials" \
  --force-delete-without-recovery --region us-west-1
```

> Always verify in the AWS Console that NAT Gateways and Elastic IPs are released — they continue to incur charges if orphaned.

---

## Troubleshooting

### CORS Errors
Update the Amplify domain in `handler.py`, `api-gateway.tf`, and `terraform.tfvars`, then redeploy Lambda and force API Gateway redeployment.

### 401 Unauthorized
Check that `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID` match between frontend and backend. Try logging out and back in.

### OCR Jobs Stuck in "Pending"
Build and push the Docker image to ECR, then update the Lambda function code. Check CloudWatch logs for the OCR worker.

### Textract AccessDeniedException with Adapter
Custom adapters only exist in `us-east-1`. The OCR worker uses a dedicated `us-east-1` Textract client for adapter calls — ensure the Lambda IAM role has `textract:*` in `us-east-1`.

### Textract InvalidS3ObjectException with Adapter
Cross-region S3 access: Textract in `us-east-1` cannot access S3 in `us-west-1`. The OCR worker downloads document bytes in-Lambda and passes them as `Document.Bytes` to resolve this.

### Lambda Deploy Fails with "No module named X"
Zip the entire `infrastructure/lambda/api/` directory, not just `handler.py`. All Python dependencies must be included in the zip.

### Default Queries Not Auto-Populating
Encode queries in the adapter's Description field: `queries:FirstName|LastName|Total`. The API calls `get_adapter` per adapter (since `list_adapters` omits the Description field) and parses this format.

### Database Connection Errors
Verify Lambda VPC config in Terraform. Security group must allow port 5432 from Lambda's security group. Both Lambda functions must be in the same VPC as RDS.

---

## Sample Documents

`sample-docs/` contains 15 test documents — 3 document types × 5 formats. Each file has unique data and field names matching the corresponding CSV columns exactly.

| Type | Formats | CSV Fields |
|---|---|---|
| Employee Record | PDF, JPG, PNG, TIFF, WEBP | EmployeeID, FirstName, LastName, Department, JobTitle, Salary, StartDate, Email, Phone, Status |
| Invoice | PDF, JPG, PNG, TIFF, WEBP | InvoiceNumber, Date, Vendor, Description, Quantity, UnitPrice, Subtotal, Tax, Total, DueDate, Status |
| Patient Record | PDF, JPG, PNG, TIFF, WEBP | PatientID, FirstName, LastName, DateOfBirth, Gender, Phone, Email, Address, InsuranceProvider, InsuranceID, PrimaryCondition, Physician, AdmissionDate, Status |

---

## License

Developed for CPSC-597 at California State University, Fullerton.

## Author

**Abhishek Jani**  
MS Computer Science, Cal State Fullerton
