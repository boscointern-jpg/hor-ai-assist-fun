# Power BI Cross-Account Access Setup

## Overview

This document explains the cross-account access setup that allows the Power BI role (`arn:aws:iam::545438366811:role/Power-BI`) to query event data stored in this AWS account using Amazon Athena.

## Permissions Granted (This Account)

The following resources have been configured to allow cross-account access from the Power BI role:

### 1. S3 Event Data Bucket

**Bucket**: `wor-aitxtcleanup-fun-data-lake-{account-id}-{region}`

**Permissions Granted**:
- `s3:GetObject` - Read event data files
- `s3:ListBucket` - List bucket contents
- `s3:GetBucketLocation` - Get bucket region information

**Resource**: `terraform/s3.tf` → `aws_s3_bucket_policy.event_data_bucket_policy`

### 2. S3 Athena Results Bucket

**Bucket**: `wor-aitxtcleanup-fun-athena-results-{account-id}-{region}`

**Permissions Granted**:
- `s3:GetObject` - Read query results
- `s3:ListBucket` - List bucket contents
- `s3:GetBucketLocation` - Get bucket region information
- `s3:PutObject` - Write query results

**Resource**: `terraform/glue.tf` → `aws_s3_bucket_policy.athena_results_policy`

### 3. AWS Glue Data Catalog

**Database**: `wor-aitxtcleanup-fun_event_data_{environment}`

**Permissions Granted**:
- `glue:GetDatabase` - Get database metadata
- `glue:GetDatabases` - List databases
- `glue:GetTable` - Get table metadata
- `glue:GetTables` - List tables
- `glue:GetPartition` - Get partition metadata
- `glue:GetPartitions` - List partitions
- `glue:BatchGetPartition` - Batch get partitions

**Resource**: `terraform/glue.tf` → `aws_glue_resource_policy.catalog_policy`

## Required Setup in Power BI AWS Account (545438366811)

The Power BI team needs to attach the following IAM policy to the `Power-BI` role in their AWS account to complete the cross-account access setup.

### IAM Policy for Power-BI Role

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AthenaQueryExecution",
      "Effect": "Allow",
      "Action": [
        "athena:StartQueryExecution",
        "athena:GetQueryExecution",
        "athena:GetQueryResults",
        "athena:StopQueryExecution",
        "athena:GetWorkGroup",
        "athena:ListWorkGroups",
        "athena:ListQueryExecutions"
      ],
      "Resource": [
        "arn:aws:athena:us-west-2:147997133155:workgroup/wor-aitxtcleanup-fun-event-data-*"
      ]
    },
    {
      "Sid": "GlueCrossAccountAccess",
      "Effect": "Allow",
      "Action": [
        "glue:GetDatabase",
        "glue:GetDatabases",
        "glue:GetTable",
        "glue:GetTables",
        "glue:GetPartition",
        "glue:GetPartitions",
        "glue:BatchGetPartition"
      ],
      "Resource": [
        "arn:aws:glue:us-west-2:147997133155:catalog",
        "arn:aws:glue:us-west-2:147997133155:database/wor-aitxtcleanup-fun_event_data_*",
        "arn:aws:glue:us-west-2:147997133155:table/wor-aitxtcleanup-fun_event_data_*/*"
      ]
    },
    {
      "Sid": "S3CrossAccountAccess",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:PutObject"
      ],
      "Resource": [
        "arn:aws:s3:::wor-aitxtcleanup-fun-data-lake-*",
        "arn:aws:s3:::wor-aitxtcleanup-fun-data-lake-*/*",
        "arn:aws:s3:::wor-aitxtcleanup-fun-athena-results-*",
        "arn:aws:s3:::wor-aitxtcleanup-fun-athena-results-*/*"
      ]
    }
  ]
}
```

### Steps for Power BI Team

1. **Log into AWS Account 545438366811**

2. **Navigate to IAM**:
   - Go to Roles
   - Find the `Power-BI` role
   - Click on the role

3. **Attach Inline Policy**:
   - Click "Add permissions" → "Create inline policy"
   - Switch to JSON editor
   - Paste the policy above
   - Name it: `CrossAccountAthenaAccess` or similar
   - Create the policy

4. **Alternative: Create Managed Policy**:
   - Navigate to IAM → Policies
   - Create a new policy using the JSON above
   - Name it: `CrossAccountAthenaAccessPolicy`
   - Attach it to the `Power-BI` role

## Connection Details for Power BI

Once the setup is complete, use these details to configure the Athena connector in Power BI:

### Connection Parameters

| Parameter | Value |
|-----------|-------|
| **Region** | `us-west-2` |
| **Database** | wor-aitxtcleanup-fun_event_data_prod |
| **Workgroup** | wor-aitxtcleanup-fun-event-data-prod |
| **S3 Output Location** | wor-aitxtcleanup-fun-athena-results-211125509520-us-west-2 |
| **Authentication** | AWS IAM Role |
| **Role ARN** | `arn:aws:iam::545438366811:role/Power-BI` |

### Getting Connection Values

Run these commands in the Terraform directory to get the exact values:

```bash
cd terraform

# Get database name
terraform output -raw glue_database_name

# Get workgroup name
terraform output -raw athena_workgroup_name

# Get Athena results bucket
terraform output -raw athena_results_bucket
```

## Available Tables

Two tables are available for querying:

### 1. text_generation_events

Contains text generation events from Bedrock with input text, generated output, and token usage.

**Key Fields**:
- `detail.generationId`
- `detail.inputText`
- `detail.output.content.document`
- `detail.output.usage.input_tokens`
- `detail.output.usage.output_tokens`
- `detail.entityId`
- `detail.entityLocationId`
- `detail.entityEmployeeId`

### 2. text_feedback_events

Contains feedback events (accept/reject) linked to generation events.

**Key Fields**:
- `detail.generationId` (links to text_generation_events)
- `detail.action` (e.g., "ACCEPT", "REJECT")
- `detail.entityId`
- `detail.entityLocationId`
- `detail.entityEmployeeId`

## Sample Queries

### Get Recent Generations with Token Usage

```sql
SELECT
    time,
    detail.generationId,
    detail.inputText,
    detail.output.content.document as generated_text,
    detail.output.usage.input_tokens,
    detail.output.usage.output_tokens
FROM text_generation_events
WHERE year = 2025
  AND month = 11
  AND day = 5
ORDER BY time DESC
LIMIT 100;
```

### Join Generations with Feedback

```sql
SELECT
    g.time as generation_time,
    g.detail.generationId,
    g.detail.inputText,
    g.detail.output.content.document as generated_text,
    f.detail.action as feedback_action,
    f.time as feedback_time
FROM text_generation_events g
LEFT JOIN text_feedback_events f
    ON g.detail.generationId = f.detail.generationId
    AND f.year = 2025 AND f.month = 11 AND f.day = 5
WHERE g.year = 2025
  AND g.month = 11
  AND g.day = 5
ORDER BY g.time DESC;
```

### Calculate Daily Token Usage

```sql
SELECT
    DATE(from_iso8601_timestamp(time)) as date,
    COUNT(*) as total_generations,
    SUM(detail.output.usage.input_tokens) as total_input_tokens,
    SUM(detail.output.usage.output_tokens) as total_output_tokens
FROM text_generation_events
WHERE year = 2025
  AND month = 11
GROUP BY DATE(from_iso8601_timestamp(time))
ORDER BY date DESC;
```

## Important Notes

### 1. Partition Filters Required

**Always include partition filters in queries** for optimal performance and cost:

```sql
WHERE year = 2025 AND month = 11 AND day = 5
```

Without these filters:
- Queries will be slower
- Costs will be higher (Athena charges by data scanned)
- May hit query limits on large datasets

### 2. Query Costs

- Athena charges **$5 per TB of data scanned**
- Using partition filters can reduce costs by 90%+
- Query results are stored in S3 and incur storage costs
- Results are automatically deleted after 30 days

### 3. Data Freshness

- Events are buffered by Firehose (up to 60 seconds)
- New data typically available within 1-2 minutes
- Partitions are discovered automatically (no manual refresh needed)

### 4. Query Limits

- Maximum query execution time: 30 minutes
- Maximum query result size: 10 GB (can be increased)
- Concurrent query limit: 20 per account (can be increased)

## Power BI Desktop Configuration

### Using AWS Athena Connector

1. **Install Athena Connector**:
   - In Power BI Desktop, go to Home → Get Data
   - Search for "Athena"
   - If not installed, download from Microsoft AppSource

2. **Configure Connection**:
   - Data source: `athena.us-west-2.amazonaws.com`
   - Database: Use value from `terraform output glue_database_name`
   - Authentication: AWS Keys or IAM role credentials

3. **Authentication Options**:

   **Option A: AWS Access Keys** (if Power-BI role has keys)
   ```
   Access Key ID: [from AWS]
   Secret Access Key: [from AWS]
   ```

   **Option B: AWS IAM Role Assumption** (recommended)
   - Configure AWS CLI profile with role assumption
   - Power BI will use the profile credentials

4. **Advanced Options**:
   - Workgroup: Use value from `terraform output athena_workgroup_name`
   - S3 Output Location: `s3://{athena_results_bucket}/query-results/`

### Using ODBC/JDBC Driver

Alternatively, use the Athena ODBC or JDBC driver:

1. **Download Driver**:
   - [Athena ODBC Driver](https://docs.aws.amazon.com/athena/latest/ug/connect-with-odbc.html)
   - [Athena JDBC Driver](https://docs.aws.amazon.com/athena/latest/ug/connect-with-jdbc.html)

2. **Configure DSN** (ODBC):
   ```
   DSN Name: AthenaEventData
   Region: us-west-2
   Workgroup: {from terraform output}
   S3 Output Location: s3://{athena_results_bucket}/query-results/
   Auth Type: IAM Credentials
   ```

3. **Connect from Power BI**:
   - Get Data → ODBC → Select your DSN
   - Enter AWS credentials when prompted

## Troubleshooting

### Access Denied Errors

**Problem**: "Access Denied" when running queries

**Solutions**:
1. Verify the IAM policy is attached to the Power-BI role in account 545438366811
2. Check that the role ARN is exactly `arn:aws:iam::545438366811:role/Power-BI`
3. Ensure the Terraform changes have been applied in the data account
4. Wait 5-10 minutes for IAM policy propagation

### Cannot Connect to Athena

**Problem**: Connection fails in Power BI

**Solutions**:
1. Verify credentials are correct
2. Check network connectivity to `athena.us-west-2.amazonaws.com`
3. Ensure the workgroup name is correct
4. Verify S3 output location is accessible

### No Data Returned

**Problem**: Queries return empty results

**Solutions**:
1. Check that events are being written to S3
2. Verify partition values in your WHERE clause
3. Run a simple query without filters to test: `SELECT * FROM text_generation_events LIMIT 10`
4. Check the date range - events may not exist for the specified dates

### Query Timeout

**Problem**: Queries time out

**Solutions**:
1. Add partition filters to reduce data scanned
2. Limit the date range in your query
3. Use more specific WHERE clauses
4. Consider creating aggregated tables for common queries

## Security Considerations

1. **Least Privilege**: The Power-BI role has read-only access to event data
2. **Encryption**: All data is encrypted at rest (S3) and in transit (TLS)
3. **Audit Trail**: AWS CloudTrail logs all cross-account access
4. **Network**: Access is through AWS APIs (no VPC peering required)
5. **Credentials**: Use IAM roles instead of long-term access keys when possible

## Monitoring

### CloudWatch Metrics

Monitor Athena usage in CloudWatch:
- Query execution time
- Data scanned per query
- Query success/failure rates

### Cost Monitoring

Track costs in AWS Cost Explorer:
- Filter by service: Athena
- Group by: Tag/Workgroup
- Set up budgets and alerts

## Support

### For Access Issues

Contact the infrastructure team that manages:
- AWS Account: 147997133155
- Stack: wor-aitxtcleanup-fun
- Region: us-west-2

### For Query Assistance

Refer to:
- `ATHENA_USAGE.md` - Comprehensive query examples
- `GLUE_SETUP_SUMMARY.md` - Architecture and setup details
- [AWS Athena Documentation](https://docs.aws.amazon.com/athena/)

## Appendix: Resource ARNs

For reference, here are the full ARNs of the resources:

### Data Account Resources (147997133155)

```
Event Data Bucket:
arn:aws:s3:::wor-aitxtcleanup-fun-data-lake-147997133155-us-west-2

Athena Results Bucket:
arn:aws:s3:::wor-aitxtcleanup-fun-athena-results-147997133155-us-west-2

Glue Database:
arn:aws:glue:us-west-2:147997133155:database/{database_name}

Athena Workgroup:
arn:aws:athena:us-west-2:147997133155:workgroup/{workgroup_name}
```

### Power BI Account Resources (545438366811)

```
Power BI Role:
arn:aws:iam::545438366811:role/Power-BI
```

## Version History

| Date | Version | Changes |
|------|---------|---------|
| 2025-11-05 | 1.0 | Initial cross-account access setup |
