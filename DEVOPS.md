**DevOps Overview**
- Purpose: Tenant security-deposit letter generator. Users submit case data, pay $2 via Stripe, get a court-ready packet and evidence storage.
- Audience: Business owners, landlords, and security reviewers. Plain, non-AI wording.

**High-Level Flow**
- Frontend (Next.js on Amplify): Collects case details and uploads evidence via presigned URLs. Talks to the API with `x-case-token` for case-level auth.
- API Gateway (REST): Public entrypoint with CORS locked to the configured frontend origin; forwards to Lambda.
- Lambda functions: Create/read cases, manage payments, generate PDFs, create presigned upload/download URLs.
- Data stores: DynamoDB `CaseFiles` table (case metadata, status, case secret), S3 evidence bucket (versioned, private).
- Payments: Stripe PaymentIntent/Checkout; success updates case status to `PAID` before packet generation.

**Core Components**
- Frontend: `web/` (Next.js). Env vars: `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
- API & Infra: `infra/` (CDK TypeScript).
  - API Gateway with CORS allow-list for the frontend origin and headers (`x-case-token`).
  - Lambda handlers (`infra/lambda/*`):
    - `create-case`, `get-case`, `list-cases`
    - `create-payment-intent`, `create-checkout-session`
    - `stripe-eventbridge` (Stripe events via EventBridge)
    - `generate-packet` (PDF creation)
    - `create-upload-url`, `get-download-url`
  - Data: DynamoDB `CaseFiles`; S3 bucket for evidence (private, versioned).
  - Secrets: Stripe API key in Secrets Manager (`stripe/secret-key`).

**Security Posture**
- CORS restricted to the configured frontend origin; `x-case-token` allowed on preflight.
- Case-level auth: client must present the stored `caseSecret` in `x-case-token`.
- Data at rest: S3 managed encryption; DynamoDB default encryption.
- Data in transit: HTTPS only (API Gateway).
- S3 bucket: Block Public Access on; presigned URLs are short-lived.
- Least privilege IAM: Lambda roles scoped to DynamoDB table, S3 bucket, and Secrets Manager read for Stripe key.
- Logging: CloudWatch Logs per function (retain for 2 years).

**Deploy/Configure**
- Prereqs: Node/npm, AWS credentials for target account/region.
- Backend deploy (CDK):
  - `npm --prefix infra install` (first time)
  - `npm --prefix infra run cdk deploy -- --parameters FrontendUrl=https://<your-frontend-domain>`
- Frontend deploy (Amplify):
  - Set env vars `NEXT_PUBLIC_API_BASE_URL` (API Gateway stage URL) and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
  - Build command (see `amplify.yml`): `npm ci && npm run build`.

**Operations**
- Payments: Stripe charge amount is $2.00 (PaymentIntent amount 200 cents).
- Packet generation allowed only after `paymentStatus = PAID`.
- Evidence uploads: client requests presigned upload URLs; bucket remains private.
- Monitoring: Use CloudWatch Logs for Lambda errors; API Gateway metrics for 4XX/5XX.
- Parameters to adjust without code changes: `FrontendUrl` (CDK param), Stripe secret in Secrets Manager.

**Architecture Diagram (Mermaid)**
```mermaid
flowchart LR
  User[Browser (Amplify)] -->|HTTPS| APIGW[API Gateway<br/>CORS allowlist]
  APIGW -->|Lambda proxy| Lambdas[Lambda Functions]
  Lambdas --> Dynamo[(CaseFiles DynamoDB)]
  Lambdas --> S3[(Evidence S3 private)]
  Lambdas --> Stripe[Stripe API]
  Stripe -->|events| EB[EventBridge]
  EB --> Lambdas
  User -->|Presigned uploads/downloads| S3
```
