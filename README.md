# DocuPop - AI-Powered Document Processing Platform

A cloud-native document management and OCR processing platform built on AWS. DocuPop enables users to upload, organize, and intelligently extract data from documents using **AWS Textract**, storing structured results in user-defined data tables with a Smart Review workflow and Analytics Dashboard.

**Built for CPSC-597 (MS Computer Science, Cal State Fullerton)**

---

## Table of Contents

- [Overview](#overview)
- [Live Demo](#live-demo)
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

1. **User signs up** via email with OTP verification through AWS Cognito
2. **Uploads documents** (PDF, PNG, JPG, TIFF, WEBP) stored in S3
3. **Creates custom data tables** to define what data to extract
4. **Queues OCR processing jobs** with optional Textract custom adapters and queries
5. **OCR Worker Lambda** processes documents using AWS Textract with per-field confidence scoring
6. **Extracted data** is mapped to table columns and stored in PostgreSQL
7. **Users review** extracted data via Smart Cards and Review Queue — approving, editing, and exporting
8. **Analytics Dashboard** provides real-time insight into processing quality and adapter performance

---

## Live Demo

- **Frontend:** https://production.d3f4lx51lbb7jw.amplifyapp.com
- **API Gateway:** https://tr3j4vxqjk.execute-api.us-west-1.amazonaws.com/api

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
                              |  - Textract Adapters        |
                              +----+----------+--------+----+
                                   |          |        |
                          +--------+    +-----+--+   +-+--------+
                          v             v        v   v           v
                    +---------+   +--------+ +-----+---+  +-----------+
                    |   RDS   |   |   S3   | |   SQS   |  |  Cognito  |
                    |PostgreSQL|  | Bucket | |  Queue  |  | User Pool |
                    | (Private)|  |        | |         |  |           |
                    +---------+   +--------+ +----+----+  +-----------+
                                                  |
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

---

## AWS Cloud Services

### 1. AWS Amplify (Frontend Hosting)
- Next.js 15 SSR on `WEB_COMPUTE` platform
- Auto-deploys on every push to `main`
- Environment variables injected at build time via `echo` commands in build spec

### 2. Amazon API Gateway
- Regional REST API with catch-all `{proxy+}` routing to the API Lambda
- CORS preflight via MOCK integration

### 3. AWS Lambda — API Handler
- **Runtime:** Python 3.11, 512 MB, 30s timeout
- **Deployment:** ZIP package (handler + all Python dependencies)
- **Responsibilities:** Auth, documents, data tables, processing jobs, Textract adapter listing

### 4. AWS Lambda — OCR Worker
- **Runtime:** Container image (Python 3.11), 1536 MB, 900s timeout
- **Trigger:** SQS queue (batch size 10, max concurrency 10)
- **Dual-region Textract:** Default client in `us-west-1` for standard OCR; dedicated `us-east-1` client for custom adapter calls. Document bytes are downloaded in-Lambda and passed directly to avoid cross-region S3 access restrictions.

### 5. Amazon RDS (PostgreSQL 15.12)
- `db.t3.micro` in private subnets
- Credentials managed by Secrets Manager
- Schema auto-initializes on first Lambda cold start

### 6. Amazon S3
- Private bucket with AES-256 encryption
- Presigned URLs for upload/download/view
- Lifecycle: Infrequent Access after 90 days

### 7. Amazon SQS
- Main queue + Dead Letter Queue (after 3 failures)
- 20s long polling, 4-day retention, 900s visibility timeout

### 8. Amazon Cognito
- Email-based sign up with OTP verification
- Forgot password via email OTP (`forgot_password` + `confirm_forgot_password`)
- Optional TOTP MFA
- JWT token flow: Cognito → `Authorization: Bearer` → Lambda validates

### 9. Amazon ECR
- Docker image storage for OCR Worker Lambda
- Keeps last 10 images

### 10. Amazon CloudWatch
- Lambda and API Gateway log groups, 14-day retention

### 11. AWS IAM
- Least-privilege roles for each Lambda (S3, SQS, Textract, Cognito, Secrets Manager, VPC)

### 12. AWS Secrets Manager
- RDS credentials, accessible only by Lambda IAM role

---

## Tech Stack

### Frontend
| Technology | Version | Purpose |
|---|---|---|
| Next.js | 15.3.1 | React framework with App Router & SSR |
| React | 19.2.1 | UI library |
| TypeScript | 5.x | Type safety |
| Tailwind CSS | 3.4.17 | Utility-first CSS |
| AG Grid | 33.0.3 | Interactive data table grid |
| Recharts | 3.8.1 | Analytics charts (dynamically imported, SSR-safe) |
| Radix UI | Latest | Accessible UI primitives |
| Lucide React | 0.468.0 | Icon library |
| Sonner | 2.0.7 | Toast notifications |
| PapaParse | 5.5.3 | CSV parsing |
| AWS SDK v3 | 3.709.0 | S3, Cognito, SQS, Textract |

### Backend
| Technology | Version | Purpose |
|---|---|---|
| Python | 3.11 | Lambda runtime |
| pg8000 | Latest | Pure Python PostgreSQL driver (API Lambda) |
| boto3 | Latest | AWS SDK |
| psycopg2 | Latest | PostgreSQL driver (OCR Worker) |

### Infrastructure
| Technology | Purpose |
|---|---|
| Terraform 1.0+ | Infrastructure as Code (~62 AWS resources) |
| Docker | Container builds for OCR Worker (`linux/amd64`) |
| GitHub Actions | CI/CD pipeline |
| AWS CLI v2 | Resource management |

---

## Project Structure

```
DocuPop/
├── app/                                    # Next.js App Router pages
│   ├── layout.tsx                          # Root layout (AuthProvider + NavBar)
│   ├── page.tsx                            # Landing page
│   ├── dashboard/
│   │   ├── page.tsx                        # Analytics Dashboard
│   │   └── DashboardCharts.tsx             # Recharts components (ssr:false)
│   ├── documents/
│   │   └── page.tsx                        # Document upload + search
│   ├── processing/
│   │   └── page.tsx                        # OCR job queue + preview modal
│   ├── data/
│   │   └── page.tsx                        # Data Hub (Table / Cards / Review)
│   ├── adapters/
│   │   └── page.tsx                        # Textract custom adapters
│   └── upload/
│       └── page.tsx                        # Upload page
│
├── components/
│   ├── AuthProvider.tsx                    # Auth context (sign in/up/out, OTP, MFA, reset)
│   ├── NavBar.tsx                          # Navigation (Home, Dashboard, Documents,
│   │                                       #   Processing, Data, Adapters)
│   ├── FileUpload.tsx                      # Drag-and-drop upload
│   ├── auth/
│   │   ├── LoginForm.tsx                   # Login + forgot password flow (inline)
│   │   ├── SignUpForm.tsx                  # Sign up + email OTP verification step
│   │   ├── MfaSetupForm.tsx
│   │   └── MfaVerifyForm.tsx
│   └── ui/                                 # button, card, input, badge, toast, etc.
│
├── lib/
│   ├── api.ts                              # Centralized API client + TypeScript interfaces
│   ├── auth-service.ts                     # signIn, signUp, confirmSignUp, forgotPassword,
│   │                                       #   confirmForgotPassword, verifyMfa, etc.
│   └── utils.ts
│
├── infrastructure/
│   ├── terraform/                          # All AWS resources as IaC
│   │   ├── main.tf, variables.tf, outputs.tf
│   │   ├── vpc.tf, rds.tf, s3.tf, sqs.tf
│   │   ├── lambda-api.tf, lambda-ocr.tf
│   │   ├── ecr.tf, cognito.tf, api-gateway.tf
│   │   ├── iam.tf, amplify.tf
│   │   └── terraform.tfvars.example
│   └── lambda/api/
│       └── handler.py                      # API Lambda (all routes, ~2600 lines)
│
├── services/ocr-worker/
│   ├── lambda_handler.py                   # SQS event handler
│   ├── textract_ocr.py                     # Dual-region Textract integration
│   ├── Dockerfile.lambda                   # linux/amd64 container
│   └── requirements-lambda.txt
│
├── sample-docs/                            # 15 sample docs (3 types × 5 formats)
│   ├── employee-sample-{pdf,jpg,png,tiff,webp}
│   ├── invoice-sample-{pdf,jpg,png,tiff,webp}
│   └── patient-sample-{pdf,jpg,png,tiff,webp}
│
└── package.json, tsconfig.json, tailwind.config.ts, next.config.js
```

---

## Features

### 1. Authentication
- **Sign Up:** Email + password → Cognito sends OTP to email → user enters code → confirmed + auto-logged in
- **Sign In:** Email + password with JWT token stored in localStorage
- **Forgot Password:** "Forgot password?" on login → enter email → OTP sent → enter code + new password → redirected to sign in
- **MFA:** Optional TOTP (authenticator app) configurable post-login
- **Multi-tenancy:** All data isolated by Cognito `sub` (UUID)
- **Re-registration safe:** Lambda cleans up stale DB rows by email on new signup

### 2. Document Management
- **Supported formats:** PDF, PNG, JPG/JPEG, TIFF, WEBP
- **Search:** Filter documents by filename or content type in real time
- **Storage:** Private S3 bucket with AES-256 encryption, presigned URLs for access
- **Actions:** View in-browser, download, delete (S3 + DB)

### 3. OCR Processing
- **Job queue:** Submit documents to SQS for async processing
- **Adapter selection:** Choose a trained Textract custom adapter from dropdown — queries auto-populate from the adapter's description field (`queries:Field1|Field2|...`)
- **Custom queries:** Add or override queries beyond the adapter defaults
- **Dual-region Textract:** Standard OCR uses `us-west-1`; adapter calls use a dedicated `us-east-1` client with document bytes passed directly (avoids cross-region S3 restrictions)
- **Document Preview:** Click any completed job to open a full split-pane modal
  - **Left pane:** Live document viewer (PDF/image via presigned S3 URL)
  - **Right pane:** Extracted fields with confidence % color-coded (green ≥90%, amber ≥70%, red <70%), metadata chips, collapsible raw text
- **Auto-refresh:** Jobs list polls every 5 seconds while any job is pending/processing — stops automatically when queue is idle
- **Dead Letter Queue:** Failed jobs after 3 retries

### 4. Textract Custom Adapters
- **Employee Adapter** (`ac65c01e1a62` v8) — ACTIVE, F1/Precision/Recall = 1.0
  - Fields: EmployeeID, FirstName, LastName, Department, JobTitle, Salary, StartDate, Email, Phone, Status
- **Patient Adapter** (`68a7b775ad0e` v2) — ACTIVE, F1/Precision/Recall = 1.0
  - Fields: PatientID, FirstName, LastName, DateOfBirth, Gender, Phone, Email, Address, InsuranceProvider, InsuranceID, PrimaryCondition, Physician, AdmissionDate, Status
- **Adapter training:** Each adapter trained on 80 synthetic PDFs with 80/20 train/test split. Manifests use `source-ref`, `annotations-ref` (PAGE/QUERY/QUERY_RESULT blocks, pruned relationships), and `prelabeling-refs` (full Textract output with LINE blocks).
- **Default queries:** Encoded in adapter `Description` field as `queries:Field1|Field2|...`; API calls `get_adapter` per adapter (since `list_adapters` omits Description) and parses this format client-side.

### 5. Data Hub
Three-view interface for reviewing and managing extracted data:

**Table View** (AG Grid)
- Inline cell editing with save-on-change
- Confidence bars embedded in each cell (color-coded)
- Toggle confidence columns on/off
- Quick search across all columns
- Zoom 30–150%, fit-all-columns
- Pagination (25/50/100/200 rows per page)
- CSV export

**Cards View**
- Type-aware styling: blue (employee), green (invoice), purple (patient)
- Per-field confidence % + colored dot
- Low-confidence fields highlighted in red
- Inline edit mode — saves to API
- Approve button only shown on rows with any field < 80% confidence

**Review Queue**
- Surfaces only rows with at least one field confidence < 80%
- Badge on tab shows pending count
- Approved section shows already-reviewed rows
- Edit → auto-approves on save

**Auto-approval logic**
- CSV-imported rows (no confidence scores) → auto-approved on load
- All fields ≥ 80% confidence → auto-approved on load
- Approval state persists in `localStorage` (`docupop_approved_ids`)

### 6. Analytics Dashboard
Real-time overview of processing activity at `/dashboard`:

| Widget | Description |
|---|---|
| **Stat Cards** | Total jobs, success rate, avg confidence, table count |
| **Jobs Over 14 Days** | Line chart of daily processing volume |
| **Job Status** | Donut chart: completed / failed / pending |
| **Adapter Impact** | Bar chart comparing avg confidence with vs without custom adapter + callout numbers |
| **Field Confidence Distribution** | Bar chart bucketing all fields into high/medium/low/no-score |
| **Avg Confidence by Table** | Bar chart per data table |
| **Recent Jobs** | Last 10 jobs with status, engine, target table, confidence, date |

> Recharts is dynamically imported with `ssr: false` — no SSR crash on page refresh.

### 7. Full Processing Workflow
```
User submits OCR job (document + table + adapter + queries)
       ↓
API Lambda creates job (status: pending) + sends SQS message
       ↓
OCR Worker Lambda triggered by SQS
       ↓
If adapter → download doc bytes from S3 → send to Textract us-east-1
If no adapter → send S3 reference to Textract us-west-1
       ↓
Textract returns blocks with per-field confidence
       ↓
Fields matched to target table via field mappings
       ↓
Stored in data_rows as JSONB {field: {value, confidence}}
       ↓
Job status → "completed"
       ↓
User reviews in Data Hub (Cards / Review Queue)
Dashboard shows updated confidence metrics
```

---

## Database Schema

Auto-initialized by the API Lambda on first request.

### users
| Column | Type | Description |
|---|---|---|
| id | UUID | Cognito sub (primary key) |
| email | TEXT UNIQUE | Email address |
| name | TEXT | Display name |
| created_at | TIMESTAMPTZ | |

### documents
| Column | Type | Description |
|---|---|---|
| id | SERIAL | Primary key |
| user_id | UUID | FK → users |
| filename | TEXT | Original filename |
| stored_filename | TEXT | S3 object key |
| file_size | INTEGER | Bytes |
| content_type | TEXT | MIME type |
| created_at | TIMESTAMPTZ | |

### data_tables
| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| user_id | UUID | FK → users |
| name | TEXT | Table name |
| description | TEXT | |
| created_at | TIMESTAMPTZ | |

### data_fields
| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| table_id | UUID | FK → data_tables |
| name | TEXT | Column name |
| data_type | TEXT | text / number / date |
| position | INTEGER | Display order |

### data_rows
| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| table_id | UUID | FK → data_tables |
| data | JSONB | `{field: {value, confidence}}` |
| created_at / updated_at | TIMESTAMPTZ | |

### data_field_mappings
| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| table_id | UUID | FK → data_tables |
| source_label | TEXT | OCR label to match |
| target_field | TEXT | Target column |
| matcher | TEXT | `contains` (default) |

### processing_jobs
| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| user_id | UUID | FK → users |
| document_id | INTEGER | FK → documents |
| status | TEXT | pending / processing / completed / failed |
| engine | TEXT | textract / tesseract |
| result | JSONB | `{fields, text, metadata}` |
| confidence | NUMERIC | Overall confidence |
| error | TEXT | Error message if failed |
| target_table_id | UUID | FK → data_tables |
| created_at / updated_at / started_at / completed_at | TIMESTAMPTZ | |

---

## API Endpoints

**Base URL:** `https://tr3j4vxqjk.execute-api.us-west-1.amazonaws.com/api`

All endpoints except auth require `Authorization: Bearer <JWT>`.

### Authentication
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/signup` | Register → Cognito sends OTP email |
| POST | `/api/auth/confirm-signup` | Verify OTP + auto-login |
| POST | `/api/auth/login` | Login, returns JWT |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Current user profile |
| POST | `/api/auth/forgot-password` | Send OTP to email |
| POST | `/api/auth/confirm-forgot-password` | OTP + new password |
| POST | `/api/auth/mfa/setup` | Get TOTP secret |
| POST | `/api/auth/mfa/verify` | Verify TOTP code |

### Documents
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/documents` | List documents |
| POST | `/api/documents` | Upload document |
| GET | `/api/documents/{id}` | Get metadata |
| DELETE | `/api/documents/{id}` | Delete (S3 + DB) |
| GET | `/api/documents/{id}/download` | Presigned download URL |
| GET | `/api/documents/{id}/view` | Presigned view URL |

### Textract Adapters
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/textract/adapters` | List adapters with `defaultQueries` (calls `get_adapter` per adapter) |

### Data Tables & Rows
| Method | Endpoint | Description |
|---|---|---|
| GET/POST | `/api/data/tables` | List / create tables |
| GET/PUT/DELETE | `/api/data/tables/{id}` | Get / update / delete table |
| POST | `/api/data/tables/{id}/fields` | Add field |
| GET/POST | `/api/data/tables/{id}/rows` | List / insert rows |
| GET/PUT/DELETE | `/api/data/tables/{id}/rows/{rowId}` | Row CRUD |
| GET/POST/DELETE | `/api/data/tables/{id}/mappings` | Field mappings |
| POST | `/api/data/tables/{id}/import` | CSV import |

### Processing
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/processing` | Submit OCR job |
| GET | `/api/processing/{id}` | Job status |
| GET | `/api/processing/jobs/next` | Worker: fetch next job |
| POST | `/api/processing/jobs/{id}` | Worker: update job status |

### Health
| Method | Endpoint |
|---|---|
| GET | `/api/health` |

---

## Prerequisites

- **Node.js** 18+ and npm
- **AWS Account** with admin IAM credentials
- **AWS CLI v2** (`aws configure`)
- **Terraform** 1.0+
- **Docker** with `linux/amd64` support (for OCR Worker)

---

## Local Development Setup

```bash
git clone https://github.com/Abhishekjani2509/Cpsc_597-DocuPop.git
cd Cpsc_597-DocuPop
npm install
```

Create `.env.local`:
```env
NEXT_PUBLIC_LOCAL_API_BASE=https://tr3j4vxqjk.execute-api.us-west-1.amazonaws.com/api
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-west-1_MTv1FePsR
NEXT_PUBLIC_COGNITO_CLIENT_ID=2anudednlpqm7i699a56or5rg4
NEXT_PUBLIC_AWS_REGION=us-west-1
```

```bash
npm run dev   # → http://localhost:3000
```

---

## AWS Deployment Guide

### Step 1: Terraform Infrastructure

```bash
cd infrastructure/terraform
terraform init
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars

export TF_VAR_github_access_token="ghp_your_pat"
terraform plan
terraform apply   # ~10-15 minutes, ~62 resources
terraform output  # save outputs
```

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

> **Important:** Zip the entire directory — not just `handler.py`. All Python dependencies must be included.

### Step 3: Deploy OCR Worker

```bash
cd services/ocr-worker

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

### Step 4: Amplify

Amplify auto-deploys on every push to `main`. Trigger the initial build:
```bash
aws amplify start-job \
  --app-id d3f4lx51lbb7jw \
  --branch-name main \
  --job-type RELEASE \
  --region us-west-1
```

### Step 5: Update CORS

After getting your Amplify URL, update `handler.py` (defaults list in `create_cors_response`), `api-gateway.tf`, and `terraform.tfvars` with the domain. Redeploy Lambda and run `terraform apply`.

---

## Environment Variables

### Frontend
| Variable | Value |
|---|---|
| `NEXT_PUBLIC_LOCAL_API_BASE` | API Gateway URL |
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | `us-west-1_MTv1FePsR` |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | `2anudednlpqm7i699a56or5rg4` |
| `NEXT_PUBLIC_AWS_REGION` | `us-west-1` |

### API Lambda (set by Terraform)
`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `S3_BUCKET`, `SQS_QUEUE_URL`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `ALLOWED_ORIGINS`, `AWS_DEFAULT_REGION`

### OCR Worker Lambda (set by Terraform)
`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_SECRET_ARN`, `S3_BUCKET`, `SQS_QUEUE_URL`, `AWS_DEFAULT_REGION`

---

## CI/CD Pipeline

Amplify auto-deploys the frontend on every push to `main`. GitHub Actions handles Lambda and infrastructure:

1. Frontend CI: `npm ci` → lint → `npm run build`
2. API Lambda: Package → `aws lambda update-function-code`
3. OCR Worker: Docker build → ECR push → Lambda update

### Required GitHub Secrets
| Secret | Description |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM access key |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key |

---

## Teardown

```bash
cd infrastructure/terraform
export TF_VAR_github_access_token="<pat>"
terraform destroy
```

If ECR fails (non-empty):
```bash
aws ecr delete-repository --repository-name docupop-staging-ocr-worker --force --region us-west-1
```

If Secrets Manager fails:
```bash
aws secretsmanager delete-secret \
  --secret-id "docupop-staging/database-credentials" \
  --force-delete-without-recovery --region us-west-1
```

> Always verify NAT Gateways and Elastic IPs are released in the AWS Console.

---

## Troubleshooting

### Dashboard crashes on page refresh
Recharts uses browser APIs. Fixed by dynamically importing `DashboardCharts.tsx` with `ssr: false` via `next/dynamic`. If you see this again, ensure recharts is never imported at the top level of a server-rendered component.

### Upload fails with FK constraint error
New user's Cognito sub not in the `users` table. The Lambda now inserts the user immediately in `handle_confirm_signup` and cleans up stale email rows (`DELETE WHERE email = X AND id != Y`) before inserting. If you still see this, check CloudWatch logs for `WARNING ensuring user`.

### CORS Errors
Update the Amplify domain in `handler.py`, `api-gateway.tf`, and `terraform.tfvars`. Redeploy Lambda and force API Gateway redeployment.

### Textract AccessDeniedException with Adapter
Custom adapters only exist in `us-east-1`. The OCR Worker uses a dedicated `us-east-1` Textract client for adapter calls. Ensure Lambda IAM role has `textract:*` permission.

### Textract InvalidS3ObjectException with Adapter
Cross-region S3: Textract `us-east-1` cannot access S3 `us-west-1`. Fixed by downloading document bytes in-Lambda and passing as `Document.Bytes`.

### Forgot Password — "no verified email"
Existing accounts created with the old auto-confirm bypass have `email_verified=false`. The Lambda now calls `admin_update_user_attributes` to set `email_verified=true` before calling `forgot_password`.

### Lambda Deploy Fails with "No module named X"
Zip the entire `infrastructure/lambda/api/` directory, not just `handler.py`.

### OCR Jobs Stuck in Pending
Build and push the Docker image to ECR. Check OCR Worker CloudWatch logs.

### Default Queries Not Auto-Populating
Adapter description must be `queries:Field1|Field2|...`. The API calls `get_adapter` per adapter since `list_adapters` omits the Description field.

---

## Sample Documents

`sample-docs/` contains 15 test documents — 3 document types × 5 formats, each with unique data and field names matching the CSV columns exactly.

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
