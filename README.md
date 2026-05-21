# hor-aitxtcleanup-fun

AI Text Cleanup and Feedback Lambda function that uses Amazon Bedrock (Claude) to generate cleaned-up versions of service order text. It also records user feedback (accept/reject/revert) on generated text for later analysis and prompt improvement.

## Architecture Overview

```
API Gateway (HTTP)
    └── Lambda (Node 22.x / TypeScript)
            ├── Amazon Bedrock (Claude 4.5 Haiku) — text generation
            ├── MySQL (RDS) — personal access token authorization
            └── EventBridge → Kinesis Firehose → S3 → Glue/Athena — event analytics
```

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/text-transform` | Generate AI-cleaned text from input |
| `POST` | `/api/v1/text-feedback` | Record user feedback on generated text |

## Tech Stack

- **Runtime**: Node.js 22.x (AWS Lambda)
- **Language**: TypeScript 5 (strict mode)
- **AI**: Amazon Bedrock — `us.anthropic.claude-haiku-4-5-20251001-v1:0`
- **Authorization**: MySQL (RDS) via SHA256 personal access token validation
- **Events**: EventBridge → Kinesis Firehose → S3 (dynamic partitioning by event type/date)
- **Analytics**: AWS Glue catalog + Athena
- **Infra**: Terraform, deployed via Harness IDP

## Bedrock Flow Deprecation
This application was originally setup to use AWS Bedrock Flow to orchestrate the model usage, but prior
to GA release, that architecture was replaced in favor of invoking the model directly via the `InvokeModelCommand`
in `src/index.ts`. The Flow architecture proved to be cumbersome and required manual intervention on every
deployment by the Sherpas via a script to publish the new version of the Flow (which could not be done via
terraform at the time). All references to bedrock flow in the terraform files - specifically `bedrock.tf`, 
`flow-definition.json`, and `iam.tf` should be ignored and are merely kept for reference and to avoid changing
the production environment.

Additionally, when the model is changed, the bedrock logging information in the `cloudwatch.tf` file should be
updated with the new model information so that the Bedrock metrics are tracked accurately.

## Local Dev Prerequisites

Install required tools (MacOS):

```shell
brew install go-task esbuild jq zoxide tig
```

Ensure `pnpm` is available:

```shell
npm install -g pnpm
```

## Fullbay Dependencies

This project uses the Fullbay CodeArtifact private registry. Set your token before installing:

```shell
export AWS_CODEARTIFACT_TOKEN=<your-token>
pnpm install
```

The `@fullbay/idp-commonutil-node-lib` (v1.0.22+) package provides the `loadRuntimeConfig()` function used for local and Lambda runtime configuration.

## Local Development
You can create a local runner which will run the handler and includes a test AWS API Gateway event, mock Lambda context, and invokes the handler in `src/index.ts`. 
It will utilize the `runtime-config-local.yml`file in the root directory for the necessary properties. 
Put this test runner in the `src/localTests` folder (already excluded in `.gitignore`).

Example `localTestHandler.ts`:
```typescript
import {type APIGatewayProxyEvent, type Context} from "aws-lambda";

import {handler} from "../index";

async function main(): Promise<void> {
  const httpRequest: APIGatewayProxyEvent = {
    "httpMethod": "POST",
    "path": "/api/v1/text-transform",
    "rawPath": "/api/v1/text-transform",
    "headers": {
      "content-type": "application/json",
      "authorization": "Bearer YOUR-LEGACY-AUTH-TOKEN"
    },
    "queryStringParameters": null,
    "pathParameters": null,
    "body": "{\"inputField\":\"Description\",\"inputText\":\"headlight out\"}",
    "isBase64Encoded": false,
    "requestContext": {
      "httpMethod": "POST",
      "path": "/api/v1/text-transform",
      "requestId": "abc123",
      "stage": "default"
    }
  } as any;
  const lambdaContext: Context = {
    "functionName": "wor-aitxtcleanup-fun",
    "functionVersion": "$LATEST",
    "invokedFunctionArn": "arn:aws:lambda:us-west-2:12345:function:wor-aitxtcleanup-fun",
    "memoryLimitInMB": 128,
    "awsRequestId": "b7d0c3e0-f8a1-4d92-9c7e-0c8a1b2d3e4f",
    "logGroupName": "/aws/lambda/wor-aitxtcleanup-fun",
    "logStreamName": "2025/09/02/[LATEST]abcdef1234567890abcdef1234567890",
    "clientContext": {
      "client": {
        "installation_id": "abcdef12-3456-7890-abcd-ef1234567890",
        "app_title": "MyMobileApp",
        "app_version_name": "1.0.0",
        "app_version_code": "1",
        "app_package_name": "com.example.mymobileapp"
      }
    }
  } as any;

  try {
    const result = await handler(httpRequest, lambdaContext);
    console.log(result);
  } catch (error) {
    console.error("Error during processing:", error);
  }
}

main();
```

### 1. Create runtime config

Create `runtime-config-local.yml` in the project root (already in `.gitignore`):

```yaml
values:
  DB_HOST: db.host.domain.com
  DB_NAME: myDatabase
  DB_PORT: 3306
  NO_AUTH: false
secrets:
  DB_USER: your_db_user
  DB_PWD: your_db_password
```

Set `NO_AUTH: true` to bypass the legacy database authorization check when testing functionality unrelated to authorization with the legacy app.

### 2. Configure IDE run settings

- **Working directory**: project root (not `localTests/`)
- **Environment variables**:
  - `AWS_PROFILE=wor-aitxtcleanup-fun`
  - `AWS_REGION=us-west-2`

### 3. Assume the IAM role

Assume the `wor-aitxtcleanup-fun` role before executing `src/localTests/localTestHandler.ts`.

NOTE that if you do want to test the authorization path from local, you need to be able to connect to the legacy database from your local machine. To connect with authorization, do the following:
1. Ensure that `DB_USER` and `DB_PWD` are set correctly in your `runtime-config-local.yml` file
2. Ensure that `NO_AUTH` is set to `false` (requires authentication)
3. Ensure that you can connect to the legacy database from your local machine (Josh Rose can assist with this)
4. Get a valid session token from the legacy webapp
5. Update the Bearer token in the `Authorization` header of your API Gateway call in the test runner with your valid session token
6. Execute the `localTestHandler.ts` file as `wor-aitxtcleanup-fun`

### Build commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Type check + transpile + test |
| `pnpm build:fast` | Transpile only (skips type check) |
| `pnpm test` | Type check + full test suite |
| `pnpm test:fast` | Jest only (skips type check) |
| `pnpm dev:watch` | Watch mode with auto-rebuild |

## Deployment

Deployments follow the standard IDP process via Harness. After merging code to `main`:

1. Run the **Terraform Plan Apply** pipeline in Harness for the target environment
2. Run the **Promote Build Artifact** pipeline on the most recent SHA from the Main CI/CD pipeline *(once per released version)*
3. Run the **Deploy `$ENVIRONMENT`** pipeline to publish the Lambda code

> **Note:** The DEV deploy runs automatically when the Main CI/CD pipeline completes.

## Monitoring & Observability

- **CloudWatch Logs**: Lambda and API Gateway logs (5–30 day retention by environment)
- **CloudWatch Dashboard**: Token usage by entity, employee, and location; cost estimation queries
- **Bedrock Invocation Logs**: Delivered to S3 for audit and analysis
- **Alarms**: High token usage thresholds per entity

Analytics data is partitioned in S3 by `event_type / year / month / day` and queryable via Athena using 
the Glue catalog. A cross-account IAM role provides Power BI read access to the S3 data lake bucket
(`wor-aitxtcleanup-fun-data-lake-{aws_account_id}-us-west-2`).
