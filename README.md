# DocuPop - AI-Powered Document Processing Platform

A cloud-native document management and OCR processing platform built on AWS. DocuPop enables users to upload, organize, and intelligently extract data from documents using **AWS Textract**, storing structured results in user-defined data tables.

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
  - [Step 1: Terraform Infrastructure](#step-1-terraform-infrastructure)
  - [Step 2: Deploy API Lambda](#step-2-deploy-api-lambda)
  - [Step 3: Deploy OCR Worker](#step-3-deploy-ocr-worker)
  - [Step 4: Create Amplify App](#step-4-create-amplify-app)
  - [Step 5: Update CORS Origins](#step-5-update-cors-origins)
- [Environment Variables](#environment-variables)
- [CI/CD Pipeline](#cicd-pipeline)
- [Teardown](#teardown)
- [Troubleshooting](#troubleshooting)
- [Sample Documents](#sample-documents)

---

## Overview

DocuPop is a full-stack document processing system that combines a modern React frontend with a serverless AWS backend. The complete workflow:

1. **User signs up/logs in** via AWS Cognito authentication
2. **Uploads documents** (PDF, images) which are stored in S3
3. **Creates custom data tables** to define what data to extract
4. **Queues OCR processing jobs** which are sent to SQS
5. **OCR worker Lambda** picks up jobs, uses AWS Textract to extract text/fields
6. **Extracted data** is mapped to user-defined table columns and stored in PostgreSQL
7. **Users review, edit, and export** the structured data

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
                                         +------------------+
                                         | OCR Worker Lambda|
                                         | (Container/ECR)  |
                                         |                  |
                                         | AWS Textract     |
                                         +------------------+
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
- **Auto-deploy**: Connected to GitHub repository; builds on push to `main`
- **Build process**: Installs dependencies, injects environment variables into `.env.production`, builds Next.js app

### 2. Amazon API Gateway (REST API)
- **Purpose**: HTTPS entry point for all backend API calls
- **Type**: Regional REST API
- **Routing**: Catch-all `{proxy+}` resource forwards all requests to the API Lambda
- **CORS**: Preflight OPTIONS handled via MOCK integration with specific origin, credentials support
- **Stage**: Single `api` stage with CloudWatch access logging

### 3. AWS Lambda - API Handler
- **Purpose**: Main backend logic - handles all HTTP requests
- **Runtime**: Python 3.11
- **Memory**: 512 MB
- **Timeout**: 30 seconds
- **Deployment**: ZIP package uploaded directly
- **Responsibilities**: Authentication, document management, data tables, processing job management
- **VPC**: Runs in private subnets for RDS access

### 4. AWS Lambda - OCR Worker
- **Purpose**: Processes OCR jobs asynchronously
- **Runtime**: Container image (Python 3.11 base)
- **Memory**: 1536 MB
- **Timeout**: 900 seconds (15 minutes)
- **Trigger**: SQS queue (batch size 10, max concurrency 10)
- **OCR Engine**: AWS Textract (AnalyzeDocument with custom queries and adapters)
- **VPC**: Runs in private subnets for RDS access

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
- **CORS**: Configured for presigned URL uploads from Amplify domain

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
- **Token Flow**: Frontend obtains JWT from Cognito -> sends as `Authorization: Bearer <token>` -> Lambda validates token
- **Multi-tenancy**: Each user identified by Cognito `sub` (UUID), all data queries filtered by user ID

### 9. Amazon ECR (Container Registry)
- **Purpose**: Stores Docker images for the OCR Worker Lambda
- **Scanning**: Image vulnerability scanning on push
- **Lifecycle**: Keeps last 10 images, auto-deletes older ones

### 10. Amazon CloudWatch (Logging & Monitoring)
- **Log Groups**:
  - `/aws/lambda/docupop-staging-api` - API Lambda logs
  - `/aws/lambda/docupop-staging-ocr-worker` - OCR Worker logs
  - `/aws/api-gateway/docupop-staging` - API Gateway access logs
- **Retention**: 14 days

### 11. AWS IAM (Permissions)
- **Lambda Execution Role**: Permissions for S3, SQS, RDS, Secrets Manager, CloudWatch, VPC, Cognito
- **API Gateway Role**: CloudWatch logging permissions
- **Principle of Least Privilege**: Each service has only the permissions it needs

### 12. AWS Secrets Manager
- **Purpose**: Stores RDS database credentials securely
- **Access**: Only Lambda functions can read the secret via IAM policy

### 13. VPC & Networking
- **VPC**: `10.0.0.0/16` CIDR block
- **Public Subnets**: 2 subnets across 2 AZs (for NAT Gateway, Internet Gateway)
- **Private Subnets**: 2 subnets across 2 AZs (for RDS, Lambda functions)
- **NAT Gateway**: Allows private subnet resources to access the internet
- **Security Groups**: Separate groups for RDS (port 5432) and Lambda functions

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
| Radix UI | Latest | Accessible UI primitives (progress bars) |
| Lucide React | 0.468.0 | Icon library |
| Sonner | 2.0.7 | Toast notifications |
| PapaParse | 5.5.3 | CSV parsing for data import |
| AWS SDK v3 | 3.709.0 | S3, Cognito, SQS, Textract, Secrets Manager |

### Backend
| Technology | Version | Purpose |
|---|---|---|
| Python | 3.11 | API Lambda runtime |
| pg8000 | Latest | Pure Python PostgreSQL driver |
| boto3 | Latest | AWS SDK for Python |
| psycopg2 | Latest | PostgreSQL driver (OCR worker) |

### Infrastructure
| Technology | Version | Purpose |
|---|---|---|
| Terraform | 1.0+ | Infrastructure as Code |
| Docker | Latest | Container builds for OCR worker |
| GitHub Actions | - | CI/CD pipeline |
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
│   │   └── page.tsx                        # OCR job processing center
│   ├── data/
│   │   └── page.tsx                        # Data tables & extracted data
│   ├── api/                                # Next.js API routes (proxy to Lambda)
│   │   ├── auth/
│   │   │   ├── signup/route.ts             # User registration
│   │   │   ├── login/route.ts              # User login
│   │   │   ├── logout/route.ts             # User logout
│   │   │   ├── me/route.ts                 # Get current user
│   │   │   ├── refresh/route.ts            # Refresh JWT token
│   │   │   ├── forgot-password/route.ts    # Password reset request
│   │   │   ├── reset-password/route.ts     # Password reset completion
│   │   │   └── mfa/
│   │   │       ├── setup/route.ts          # MFA setup (TOTP)
│   │   │       └── verify/route.ts         # MFA code verification
│   │   ├── documents/
│   │   │   ├── route.ts                    # List & upload documents
│   │   │   └── [id]/
│   │   │       ├── route.ts                # Get/delete document
│   │   │       ├── download/route.ts       # Presigned download URL
│   │   │       └── view/route.ts           # Presigned view URL
│   │   ├── processing/
│   │   │   ├── route.ts                    # List & submit OCR jobs
│   │   │   ├── [id]/route.ts              # Job status/details
│   │   │   └── jobs/
│   │   │       ├── next/route.ts           # Worker: fetch next job
│   │   │       └── [id]/route.ts           # Worker: update job status
│   │   └── data/
│   │       └── tables/
│   │           ├── route.ts                # List & create tables
│   │           └── [id]/
│   │               ├── route.ts            # Get/update/delete table
│   │               ├── rows/
│   │               │   ├── route.ts        # List & insert rows
│   │               │   └── [rowId]/route.ts # Get/update/delete row
│   │               ├── mappings/
│   │               │   ├── route.ts        # List & create mappings
│   │               │   └── [mappingId]/route.ts # Update/delete mapping
│   │               ├── fields/route.ts     # Manage table fields
│   │               └── import/route.ts     # CSV data import
│   └── globals.css                         # Global styles
│
├── components/                             # React Components
│   ├── AuthProvider.tsx                    # Authentication context provider
│   ├── NavBar.tsx                          # Navigation bar
│   ├── FileUpload.tsx                      # Drag-and-drop file upload
│   ├── LinedPaper.tsx                      # Decorative background
│   ├── auth/
│   │   ├── LoginForm.tsx                   # Login form
│   │   ├── SignUpForm.tsx                  # Registration form
│   │   ├── MfaSetupForm.tsx               # MFA setup UI
│   │   └── MfaVerifyForm.tsx              # MFA verification UI
│   └── ui/                                 # Reusable UI primitives
│       ├── button.tsx
│       ├── card.tsx
│       ├── input.tsx
│       ├── textarea.tsx
│       ├── badge.tsx
│       ├── progress.tsx
│       ├── skeleton.tsx
│       ├── empty-state.tsx
│       ├── toast.tsx
│       └── view-toggle.tsx
│
├── lib/                                    # Frontend Libraries
│   ├── api.ts                              # Centralized API client
│   ├── auth-service.ts                     # Authentication service
│   └── utils.ts                            # Utility functions
│
├── server/                                 # Server-side Logic
│   ├── config.ts                           # Environment configuration
│   ├── db.ts                               # Database connection pool
│   ├── data-store.ts                       # Data persistence layer
│   ├── data-tables.ts                      # Data table operations
│   ├── processing-store.ts                 # OCR job management
│   ├── storage-service.ts                  # S3 integration
│   ├── sqs-service.ts                      # SQS queue operations
│   └── auth/                               # Auth handlers
│
├── infrastructure/                         # Infrastructure Code
│   ├── terraform/                          # Terraform IaC
│   │   ├── main.tf                         # Provider config, locals
│   │   ├── variables.tf                    # Input variable definitions
│   │   ├── outputs.tf                      # Output values
│   │   ├── vpc.tf                          # VPC, subnets, NAT, security groups
│   │   ├── rds.tf                          # PostgreSQL database
│   │   ├── s3.tf                           # Document storage bucket
│   │   ├── sqs.tf                          # OCR job queues
│   │   ├── lambda-api.tf                   # API Lambda function
│   │   ├── lambda-ocr.tf                   # OCR Worker Lambda
│   │   ├── ecr.tf                          # Container registry
│   │   ├── cognito.tf                      # User authentication
│   │   ├── api-gateway.tf                  # REST API + CORS
│   │   ├── iam.tf                          # IAM roles & policies
│   │   ├── amplify.tf                      # Frontend hosting
│   │   └── terraform.tfvars.example        # Example variable values
│   └── lambda/
│       └── api/
│           └── handler.py                  # API Lambda handler (all routes)
│
├── services/
│   └── ocr-worker/                         # OCR Worker Service
│       ├── lambda_handler.py               # SQS event handler
│       ├── textract_ocr.py                 # AWS Textract integration
│       ├── worker.py                       # Local dev worker (Tesseract)
│       ├── Dockerfile.lambda               # Container image definition
│       ├── requirements-lambda.txt         # Production dependencies
│       ├── requirements.txt                # Dev dependencies
│       └── deploy-lambda.sh                # Deployment script
│
├── scripts/
│   └── reset-database.ts                   # Database reset utility
│
├── sample-docs/                            # Sample test documents
│   ├── invoice-sample.pdf
│   ├── employee-record.pdf
│   └── patient-intake-form.pdf
│
├── .github/
│   └── workflows/                          # GitHub Actions CI/CD
│
├── package.json                            # Node.js dependencies
├── tsconfig.json                           # TypeScript configuration
├── next.config.js                          # Next.js configuration
├── tailwind.config.ts                      # Tailwind CSS configuration
├── postcss.config.mjs                      # PostCSS configuration
└── .gitignore                              # Git ignore rules
```

---

## Features

### 1. User Authentication
- **Sign Up**: Email + password registration via AWS Cognito
- **Login**: JWT-based authentication with token refresh
- **MFA**: Optional TOTP-based multi-factor authentication
- **Password Reset**: Forgot password flow via Cognito
- **Session Persistence**: Tokens stored in localStorage, auto-refresh on expiry
- **Multi-tenant**: All data isolated by Cognito user ID (`sub`)

### 2. Document Management
- **Upload**: Drag-and-drop or click-to-upload interface
- **Storage**: Documents stored in private S3 bucket with AES-256 encryption
- **View**: In-browser document viewer via presigned URLs
- **Download**: Secure download links via presigned URLs (1-hour expiry)
- **Delete**: Removes document from both S3 and database
- **Supported Formats**: PDF, PNG, JPG, JPEG, TIFF

### 3. Data Tables
- **Custom Schemas**: Define tables with named, typed columns (text, number, date)
- **CRUD Operations**: Create, read, update, and delete rows
- **AG Grid Integration**: Interactive spreadsheet-like interface for data editing
- **CSV Import**: Upload CSV files to auto-create columns and import data
- **Field Mappings**: Map OCR extraction labels to table columns

### 4. OCR Processing
- **Job Queue**: Submit documents for OCR processing via SQS
- **AWS Textract**: Production OCR engine with high accuracy
- **Custom Adapters**: Use Textract custom adapters for specialized document types (invoices, forms, etc.)
- **Custom Queries**: Define targeted extraction queries for specific fields
- **Field Matching**: Multi-tier matching (label-value, proximity, regex/semantic patterns)
- **Confidence Scoring**: Per-field confidence scores from Textract
- **Auto-mapping**: Extracted fields automatically mapped to target table columns
- **Status Tracking**: Real-time job status (pending, processing, completed, failed)
- **Dead Letter Queue**: Failed jobs sent to DLQ after 3 retry attempts

### 5. Processing Workflow
```
User submits OCR job
       |
       v
API Lambda validates request
       |
       v
Job record created in PostgreSQL (status: pending)
       |
       v
Message sent to SQS queue
       |
       v
OCR Worker Lambda triggered by SQS
       |
       v
Worker downloads document from S3
       |
       v
AWS Textract processes document
       |
       v
Extracted fields matched to target table schema
       |
       v
Results stored in data_rows (JSONB with confidence)
       |
       v
Job status updated to "completed"
```

---

## Database Schema

The database is automatically initialized by the API Lambda on first request. All tables are created in PostgreSQL:

### users
| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key (matches Cognito sub) |
| email | TEXT | Unique email address |
| name | TEXT | Display name |
| password_hash | TEXT | Not used with Cognito (legacy) |
| created_at | TIMESTAMPTZ | Account creation time |

### documents
| Column | Type | Description |
|---|---|---|
| id | SERIAL | Auto-increment primary key |
| user_id | UUID | Foreign key to users (CASCADE delete) |
| filename | TEXT | Original filename |
| stored_filename | TEXT | S3 object key |
| file_size | INTEGER | File size in bytes |
| content_type | TEXT | MIME type |
| created_at | TIMESTAMPTZ | Upload time |

### data_tables
| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| user_id | UUID | Foreign key to users (CASCADE delete) |
| name | TEXT | Table name |
| description | TEXT | Optional description |
| created_at | TIMESTAMPTZ | Creation time |

### data_fields
| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| table_id | UUID | Foreign key to data_tables (CASCADE delete) |
| name | TEXT | Field/column name |
| data_type | TEXT | Type: text, number, date |
| position | INTEGER | Column display order |

### data_rows
| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| table_id | UUID | Foreign key to data_tables (CASCADE delete) |
| data | JSONB | Row data: `{field_name: {value, confidence}}` |
| created_at | TIMESTAMPTZ | Creation time |
| updated_at | TIMESTAMPTZ | Last update time |

### data_field_mappings
| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| table_id | UUID | Foreign key to data_tables (CASCADE delete) |
| source_label | TEXT | OCR extraction label to match |
| target_field | TEXT | Target table field name |
| matcher | TEXT | Matching strategy (default: `contains`) |
| created_at | TIMESTAMPTZ | Creation time |

### processing_jobs
| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| user_id | UUID | Foreign key to users (CASCADE delete) |
| document_id | INTEGER | Foreign key to documents (CASCADE delete) |
| status | TEXT | pending, processing, completed, failed |
| engine | TEXT | OCR engine: textract or tesseract |
| priority | INTEGER | Job priority (default: 0) |
| result | JSONB | OCR extraction results |
| confidence | NUMERIC | Overall confidence score |
| error | TEXT | Error message if failed |
| target_table_id | UUID | Optional target table for auto-mapping |
| created_at | TIMESTAMPTZ | Job creation time |
| updated_at | TIMESTAMPTZ | Last status update |
| started_at | TIMESTAMPTZ | Processing start time |
| completed_at | TIMESTAMPTZ | Processing completion time |

---

## API Endpoints

**Base URL**: `https://<api-gateway-id>.execute-api.us-west-1.amazonaws.com/api`

All endpoints (except auth) require `Authorization: Bearer <JWT>` header.

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
| GET | `/api/documents` | List all user's documents |
| POST | `/api/documents` | Upload a document (base64 body) |
| GET | `/api/documents/{id}` | Get document metadata |
| DELETE | `/api/documents/{id}` | Delete document (S3 + DB) |
| GET | `/api/documents/{id}/download` | Get presigned download URL |
| GET | `/api/documents/{id}/view` | Get presigned view URL |

### Data Tables
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/data/tables` | List all tables |
| POST | `/api/data/tables` | Create a new table |
| GET | `/api/data/tables/{id}` | Get table with fields |
| PUT | `/api/data/tables/{id}` | Update table |
| DELETE | `/api/data/tables/{id}` | Delete table |

### Data Rows
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/data/tables/{id}/rows` | List all rows |
| POST | `/api/data/tables/{id}/rows` | Insert a new row |
| GET | `/api/data/tables/{id}/rows/{rowId}` | Get single row |
| PUT | `/api/data/tables/{id}/rows/{rowId}` | Update row |
| DELETE | `/api/data/tables/{id}/rows/{rowId}` | Delete row |

### Field Mappings
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/data/tables/{id}/mappings` | List field mappings |
| POST | `/api/data/tables/{id}/mappings` | Create mapping |
| PUT | `/api/data/tables/{id}/mappings/{mid}` | Update mapping |
| DELETE | `/api/data/tables/{id}/mappings/{mid}` | Delete mapping |

### Data Import
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/data/tables/{id}/import` | Import CSV data |

### Processing Jobs
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/processing` | Submit OCR job |
| GET | `/api/processing/{id}` | Get job status |
| GET | `/api/processing/jobs/next` | Worker: fetch next job |
| POST | `/api/processing/jobs/{id}` | Worker: update job status |

### Health Check
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | API health check |

---

## Prerequisites

### Required
- **Node.js** 18+ and **npm**
- **AWS Account** with IAM user/role having admin permissions
- **AWS CLI v2** configured with credentials (`aws configure`)
- **Terraform** 1.0+
- **Git**

### For OCR Worker Deployment
- **Docker** (for building OCR worker container image)

### Optional (Local Development)
- **Python 3.11** (for testing Lambda code locally)
- **PostgreSQL** (for local database testing)

---

## Local Development Setup

### 1. Clone & Install

```bash
git clone https://github.com/Abhishekjani2509/Cpsc_597-DocuPop.git
cd Cpsc_597-DocuPop
npm install
```

### 2. Configure Environment

Create `.env.local` in the project root:

```env
# API Gateway URL (from terraform output)
NEXT_PUBLIC_LOCAL_API_BASE=https://<api-id>.execute-api.us-west-1.amazonaws.com/api

# Cognito Configuration (from terraform output)
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-west-1_XXXXXXXXX
NEXT_PUBLIC_COGNITO_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
NEXT_PUBLIC_AWS_REGION=us-west-1
```

### 3. Run Development Server

```bash
npm run dev
```

The app runs at `http://localhost:3000` and connects to the live AWS backend.

---

## AWS Deployment Guide

Complete guide to deploy DocuPop from scratch on AWS.

### Step 1: Terraform Infrastructure

Terraform provisions ~62 AWS resources: VPC, subnets, NAT Gateway, RDS, S3, SQS, Lambda functions, API Gateway, Cognito, ECR, IAM roles, and CloudWatch log groups.

```bash
cd infrastructure/terraform

# Initialize Terraform
terraform init

# Create terraform.tfvars (copy from example and customize)
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` with your values:

```hcl
# Project
project_name = "docupop"
environment  = "staging"
aws_region   = "us-west-1"

# Database
db_name                = "docupop"
db_master_username     = "docupop_admin"
db_min_capacity        = 0.5
db_max_capacity        = 4
db_skip_final_snapshot = true
db_deletion_protection = false

# S3
s3_force_destroy = true

# Lambda
lambda_api_memory  = 512
lambda_api_timeout = 30
lambda_ocr_memory  = 1536
lambda_ocr_timeout = 300

# CORS - Update with your Amplify URL after Step 4
allowed_origins = [
  "http://localhost:3000",
  "https://main.<amplify-app-id>.amplifyapp.com",
  "https://<amplify-app-id>.amplifyapp.com"
]

# GitHub (for Amplify)
github_repository_url = "https://github.com/<your-username>/<your-repo>"
```

Deploy infrastructure:

```bash
# Set GitHub token for Amplify
export TF_VAR_github_access_token="ghp_your_github_pat_here"

# Preview changes
terraform plan

# Deploy (~10-15 minutes)
terraform apply
```

Save the outputs - you'll need them:

```bash
terraform output
```

Key outputs:
- `api_gateway_id` - API Gateway ID for constructing the URL
- `cognito_user_pool_id` - Cognito User Pool ID
- `cognito_client_id` - Cognito App Client ID
- `api_lambda_function_name` - Lambda function name for code updates
- `ecr_repository_url` - ECR URL for OCR worker images
- `s3_bucket_name` - Document storage bucket
- `database_endpoint` - RDS endpoint (sensitive)

### Step 2: Deploy API Lambda

The API Lambda runs all backend logic. Package and deploy it:

```bash
cd infrastructure/lambda/api

# Install Python dependencies locally
pip install pg8000 scramp asn1crypto -t .

# Package everything into a ZIP
zip -r /tmp/api-lambda.zip handler.py pg8000/ scramp/ asn1crypto/ \
  -x "*.pyc" "__pycache__/*"

# Deploy to AWS
aws lambda update-function-code \
  --function-name docupop-staging-api \
  --zip-file fileb:///tmp/api-lambda.zip \
  --region us-west-1
```

### Step 3: Deploy OCR Worker

The OCR worker runs as a container image Lambda:

```bash
cd services/ocr-worker

# Build Docker image (must target linux/amd64 for Lambda)
docker buildx build --platform linux/amd64 \
  -f Dockerfile.lambda \
  -t 925091290325.dkr.ecr.us-west-1.amazonaws.com/docupop-staging-ocr-worker:latest \
  --provenance=false --sbom=false .

# Login to ECR
aws ecr get-login-password --region us-west-1 | \
  docker login --username AWS --password-stdin \
  925091290325.dkr.ecr.us-west-1.amazonaws.com

# Push image
docker push 925091290325.dkr.ecr.us-west-1.amazonaws.com/docupop-staging-ocr-worker:latest

# Update Lambda to use new image
aws lambda update-function-code \
  --function-name docupop-staging-ocr-worker \
  --image-uri 925091290325.dkr.ecr.us-west-1.amazonaws.com/docupop-staging-ocr-worker:latest \
  --region us-west-1
```

### Step 4: Create Amplify App

Create the Amplify app via AWS CLI with the correct SSR platform:

```bash
# Get API Gateway URL from terraform output
API_URL="https://$(terraform -chdir=infrastructure/terraform output -raw api_gateway_id).execute-api.us-west-1.amazonaws.com/api"
POOL_ID=$(terraform -chdir=infrastructure/terraform output -raw cognito_user_pool_id)
CLIENT_ID=$(terraform -chdir=infrastructure/terraform output -raw cognito_client_id)

aws amplify create-app \
  --name "docupop-staging" \
  --repository "https://github.com/<your-username>/<your-repo>" \
  --access-token "<your-github-pat>" \
  --platform "WEB_COMPUTE" \
  --region us-west-1 \
  --environment-variables "{
    \"NEXT_PUBLIC_LOCAL_API_BASE\": \"$API_URL\",
    \"NEXT_PUBLIC_COGNITO_USER_POOL_ID\": \"$POOL_ID\",
    \"NEXT_PUBLIC_COGNITO_CLIENT_ID\": \"$CLIENT_ID\",
    \"NEXT_PUBLIC_AWS_REGION\": \"us-west-1\"
  }" \
  --build-spec "
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
    build:
      commands:
        - echo \"NEXT_PUBLIC_LOCAL_API_BASE=$API_URL\" >> .env.production
        - echo \"NEXT_PUBLIC_COGNITO_USER_POOL_ID=$POOL_ID\" >> .env.production
        - echo \"NEXT_PUBLIC_COGNITO_CLIENT_ID=$CLIENT_ID\" >> .env.production
        - echo \"NEXT_PUBLIC_AWS_REGION=us-west-1\" >> .env.production
        - npm run build
  artifacts:
    baseDirectory: .next
    files:
      - '**/*'
  cache:
    paths:
      - .next/cache/**/*
      - node_modules/**/*
"
```

Then create and deploy the main branch:

```bash
APP_ID="<amplify-app-id-from-above>"

# Create branch
aws amplify create-branch \
  --app-id $APP_ID \
  --branch-name main \
  --framework "Next.js - SSR" \
  --region us-west-1

# Trigger first build
aws amplify start-job \
  --app-id $APP_ID \
  --branch-name main \
  --job-type RELEASE \
  --region us-west-1
```

Your frontend will be available at: `https://main.<app-id>.amplifyapp.com`

> **Important**: The build spec hardcodes environment variables using `echo` commands because Amplify app-level environment variables may not propagate to the Next.js build process for `NEXT_PUBLIC_` variables.

### Step 5: Update CORS Origins

After creating the Amplify app, update the CORS configuration with the new Amplify domain:

**1. Update `infrastructure/lambda/api/handler.py`:**

Find the `defaults` list in `create_cors_response()` and update the Amplify URLs:

```python
defaults = [
    'https://main.<your-app-id>.amplifyapp.com',
    'https://<your-app-id>.amplifyapp.com',
    'http://localhost:3000',
]
```

Also update the fallback origin:

```python
allow_origin = 'https://main.<your-app-id>.amplifyapp.com'
```

**2. Update `infrastructure/terraform/api-gateway.tf`:**

Update the OPTIONS CORS response:

```hcl
"method.response.header.Access-Control-Allow-Origin" = "'https://main.<your-app-id>.amplifyapp.com'"
```

**3. Update `infrastructure/terraform/terraform.tfvars`:**

```hcl
allowed_origins = [
  "http://localhost:3000",
  "https://main.<your-app-id>.amplifyapp.com",
  "https://<your-app-id>.amplifyapp.com"
]
```

**4. Redeploy:**

```bash
# Repackage and deploy Lambda
cd infrastructure/lambda/api
zip -r /tmp/api-lambda.zip handler.py pg8000/ scramp/ asn1crypto/
aws lambda update-function-code \
  --function-name docupop-staging-api \
  --zip-file fileb:///tmp/api-lambda.zip \
  --region us-west-1

# Apply terraform changes
cd infrastructure/terraform
export TF_VAR_github_access_token="<your-pat>"
terraform apply

# Force redeploy API Gateway
aws apigateway create-deployment \
  --rest-api-id <api-gateway-id> \
  --stage-name api \
  --region us-west-1
```

---

## Environment Variables

### Frontend (.env.local / Amplify)

| Variable | Description | Example |
|---|---|---|
| `NEXT_PUBLIC_LOCAL_API_BASE` | API Gateway base URL | `https://abc123.execute-api.us-west-1.amazonaws.com/api` |
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | Cognito User Pool ID | `us-west-1_ABC123` |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | Cognito App Client ID | `1234567890abcdef` |
| `NEXT_PUBLIC_AWS_REGION` | AWS region | `us-west-1` |

### API Lambda (Set by Terraform)

| Variable | Description |
|---|---|
| `DB_HOST` | RDS endpoint |
| `DB_PORT` | Database port (5432) |
| `DB_NAME` | Database name |
| `DB_USER` | Database username |
| `DB_PASSWORD` | Database password |
| `S3_BUCKET` | Document storage bucket name |
| `SQS_QUEUE_URL` | OCR job queue URL |
| `COGNITO_USER_POOL_ID` | Cognito User Pool ID |
| `COGNITO_CLIENT_ID` | Cognito App Client ID |
| `ALLOWED_ORIGINS` | JSON array of allowed CORS origins |
| `AWS_REGION` | AWS region |

### OCR Worker Lambda (Set by Terraform)

| Variable | Description |
|---|---|
| `DB_HOST` | RDS endpoint |
| `DB_PORT` | Database port |
| `DB_NAME` | Database name |
| `DB_SECRET_ARN` | Secrets Manager ARN for DB credentials |
| `S3_BUCKET` | Document storage bucket name |
| `SQS_QUEUE_URL` | OCR job queue URL |
| `AWS_REGION` | AWS region |

---

## CI/CD Pipeline

GitHub Actions automates testing and deployment on push to `main` or `staging`.

### Pipeline Steps

1. **Frontend CI**: `npm ci` -> lint -> `npm run build`
2. **API Lambda Deploy**: Package Python code -> `aws lambda update-function-code`
3. **OCR Worker Deploy**: Build Docker -> Push to ECR -> Update Lambda
4. **Infrastructure** (Optional): `terraform plan` / `terraform apply`

### Required GitHub Secrets

| Secret | Description |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM user access key |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key |

### Amplify Auto-Deploy

Amplify is connected to the GitHub repository. When code is pushed to `main`, Amplify automatically:
1. Pulls the latest code
2. Runs `npm ci`
3. Writes env vars to `.env.production`
4. Runs `npm run build`
5. Deploys the SSR application

---

## Teardown

To remove all AWS resources and stop incurring costs:

```bash
cd infrastructure/terraform

# Set the GitHub token (required by Terraform)
export TF_VAR_github_access_token="<your-pat>"

# Destroy all resources (~5-10 minutes)
terraform destroy
```

If ECR repository fails to delete (non-empty):

```bash
aws ecr delete-repository \
  --repository-name docupop-staging-ocr-worker \
  --force \
  --region us-west-1
```

If Secrets Manager secret fails (scheduled for deletion):

```bash
aws secretsmanager delete-secret \
  --secret-id "docupop-staging/database-credentials" \
  --force-delete-without-recovery \
  --region us-west-1
```

Delete the Amplify app separately (if created via CLI, not Terraform):

```bash
aws amplify delete-app --app-id <app-id> --region us-west-1
```

> **Note**: Always verify in the AWS Console that no resources remain (check VPCs, NAT Gateways, Elastic IPs).

---

## Troubleshooting

### CORS Errors
- **Symptom**: Browser shows `Access-Control-Allow-Origin` errors
- **Cause**: Frontend origin not in Lambda's allowed origins list or API Gateway OPTIONS response
- **Fix**: Update the Amplify domain in `handler.py`, `api-gateway.tf`, and `terraform.tfvars`, then redeploy Lambda and force API Gateway redeployment

### 401 Unauthorized
- **Symptom**: API calls return 401
- **Cause**: JWT token expired or invalid
- **Fix**: Check that Cognito User Pool ID and Client ID match between frontend and backend. Try logging out and back in.

### "Failed to fetch" on Signup/Login
- **Cause 1**: `NEXT_PUBLIC_LOCAL_API_BASE` has `/api` suffix causing double `/api/api/...` path
- **Fix**: Ensure the env var does NOT end with `/api` if routes already include it, or ensure it does if routes don't
- **Cause 2**: Environment variable not baked into the Amplify build
- **Fix**: Use `echo` commands in the build spec to write vars to `.env.production`

### OCR Jobs Stuck in "Pending"
- **Cause**: OCR Worker Lambda not deployed or no Docker image in ECR
- **Fix**: Build and push the Docker image to ECR, then update the Lambda function code

### Database Connection Errors
- **Cause**: Lambda not in the correct VPC/subnets, or security group not allowing port 5432
- **Fix**: Verify Lambda VPC config in Terraform, check security group rules

### Logout on Page Refresh
- **Cause**: `ensure_user_in_db` raising an exception, causing `/auth/me` to return 401
- **Fix**: The handler catches DB errors gracefully - ensure you have the latest handler.py deployed

### Document Delete "ID Not Found"
- **Cause**: Path parsing mismatch between API Gateway and Lambda
- **Fix**: Use `extract_id_from_path()` helper in handler.py (already implemented)

---

## Sample Documents

The `sample-docs/` directory contains test documents for demo purposes:

| Document | Type | Use Case |
|---|---|---|
| `invoice-sample.pdf` | Invoice | Extract line items, totals, dates, vendor info |
| `employee-record.pdf` | HR Form | Extract employee details, dates, department |
| `patient-intake-form.pdf` | Medical Form | Extract patient info, medical history |

---

## License

This project was developed for CPSC-597 at California State University, Fullerton.

---

## Author

**Abhishek Jani**
MS Computer Science, Cal State Fullerton
