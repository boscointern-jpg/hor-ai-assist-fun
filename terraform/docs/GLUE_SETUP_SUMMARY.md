# AWS Glue and Athena Setup Summary

## Overview

This Terraform configuration sets up AWS Glue Catalog and Amazon Athena to enable SQL querying of event data stored in S3. The setup handles two types of events: **TextGenerationEvent** and **TextFeedbackEvent**.

## What Was Created

### 1. Glue Resources (`glue.tf`)

#### Glue Database
- **Resource**: `aws_glue_catalog_database.event_data`
- **Name**: `{stack_id}_event_data_{environment}`
- **Purpose**: Catalog for organizing event tables

#### Glue Tables
Two tables were created to handle the different event schemas:

##### Text Generation Events Table
- **Resource**: `aws_glue_catalog_table.text_generation_events`
- **Table Name**: `text_generation_events`
- **Schema**: Includes fields for generation metadata, input text, output document, and token usage
- **Event Type**: `TextGenerationEvent` from Bedrock
- **Key Fields**:
  - `detail.generationId`: Unique generation identifier
  - `detail.inputText`: Original input text
  - `detail.output.content.document`: Generated text
  - `detail.output.usage.input_tokens`: Input token count
  - `detail.output.usage.output_tokens`: Output token count

##### Text Feedback Events Table
- **Resource**: `aws_glue_catalog_table.text_feedback_events`
- **Table Name**: `text_feedback_events`
- **Schema**: Includes feedback actions and metadata
- **Event Type**: `TextFeedbackEvent`
- **Key Fields**:
  - `detail.generationId`: Links to the generation event
  - `detail.action`: Feedback action (e.g., "ACCEPT", "REJECT")
  - `detail.entityId`: Entity identifier

#### Partitioning Strategy
Both tables use **partition projection** for automatic partition discovery:
- **Partitions**: `event_type`, `year`, `month`, `day`
- **Format**: `event_type={EventType}/year=YYYY/month=MM/day=DD/`
- **Event Type Values**:
  - `text_generation_events` table: `TextGenerationEvent` only
  - `text_feedback_events` table: `TextFeedbackEvent` only
- **Range**: Years 2024-2030, months 1-12, days 1-31
- **Benefits**:
  - No need to run `MSCK REPAIR TABLE`
  - Instant partition availability
  - Better query performance when filtering by date
  - Events automatically separated by type in S3

#### IAM Role for Glue
- **Resource**: `aws_iam_role.glue_crawler`
- **Purpose**: Allows Glue to read from S3 and manage catalog
- **Permissions**:
  - S3 read access to event data bucket
  - Glue catalog management
  - CloudWatch Logs for crawler logging

### 2. Athena Resources

#### Athena Workgroup
- **Resource**: `aws_athena_workgroup.event_data`
- **Name**: `{stack_id}-event-data-{environment}`
- **Configuration**:
  - Enforces workgroup configuration
  - CloudWatch metrics enabled
  - Results stored in dedicated S3 bucket
  - SSE-S3 encryption for query results

#### Athena Results Bucket
- **Resource**: `aws_s3_bucket.athena_results`
- **Name**: `{stack_id}-athena-results-{account_id}-{region}`
- **Features**:
  - Versioning enabled
  - 30-day lifecycle policy for results
  - 7-day retention for old versions
  - Server-side encryption (AES256)
  - Public access blocked

### 3. Updated Kinesis Firehose (`kinesis.tf`)

The Kinesis Firehose delivery stream was updated to support dynamic partitioning:

#### Dynamic Partitioning Configuration
- **Enabled**: Yes
- **Partition Keys**: Extracted from the `time` field in events
- **Format**: `year=YYYY/month=MM/day=DD/`
- **JQ Query**: `{year:(.time[0:4]),month:(.time[5:7]),day:(.time[8:10])}`

#### Benefits
- Events are automatically organized by date in S3
- Athena queries are more efficient with partition pruning
- Easier to manage data lifecycle and retention

#### Processing Configuration
1. **MetadataExtraction**: Extracts year, month, day from timestamp
2. **AppendDelimiterToRecord**: Adds newlines between JSON records

### 4. Terraform Outputs (`outputs.tf`)

New outputs were added for easy reference:
- `glue_database_name`: Name of the Glue database
- `text_generation_events_table`: Generation events table name
- `text_feedback_events_table`: Feedback events table name
- `athena_workgroup_name`: Athena workgroup name
- `athena_results_bucket`: S3 bucket for query results
- `event_data_bucket`: S3 bucket containing event data

## Data Flow

```
EventBridge → Firehose → S3 (partitioned) → Glue Catalog → Athena
```

1. **EventBridge**: Receives TextGenerationEvent and TextFeedbackEvent
2. **Firehose**: Processes events, extracts event_type and date partitions, writes to S3
3. **S3**: Stores events in `event_type={Type}/year=YYYY/month=MM/day=DD/` structure
4. **Glue Catalog**: Provides schema and partition metadata (separate tables per event type)
5. **Athena**: Queries data using SQL with partition pruning for efficient filtering

## S3 Directory Structure

```
s3://{bucket}/
├── event_type=TextGenerationEvent/
│   ├── year=2025/
│   │   ├── month=01/
│   │   │   ├── day=01/
│   │   │   │   ├── events-1.json
│   │   │   │   └── events-2.json
│   │   │   ├── day=02/
│   │   │   │   └── events-1.json
│   │   ├── month=02/
│   │   │   └── day=01/
│   │   │       └── events-1.json
├── event_type=TextFeedbackEvent/
│   ├── year=2025/
│   │   ├── month=01/
│   │   │   ├── day=01/
│   │   │   │   ├── feedback-1.json
│   │   │   │   └── feedback-2.json
└── firehose_errors/
    └── processing-failed/
        └── year=2025/...
```

## Usage

### Getting Started

1. **Apply Terraform changes**:
   ```bash
   cd terraform
   terraform init
   terraform plan
   terraform apply
   ```

2. **Get output values**:
   ```bash
   terraform output glue_database_name
   terraform output athena_workgroup_name
   ```

3. **Navigate to Athena in AWS Console**

4. **Select the workgroup** (from output)

5. **Choose the database** (from output)

6. **Run queries** (see ATHENA_USAGE.md for examples)

### Example Query

```sql
-- Get recent text generation events
SELECT
    time,
    detail.generationId,
    detail.inputText,
    detail.output.content.document as generated_text
FROM text_generation_events
WHERE year = 2025
  AND month = 11
  AND day = 5
ORDER BY time DESC
LIMIT 10;
```

## Important Notes

### Partition Filters Are Required

Always include partition filters in your queries for optimal performance:

```sql
WHERE year = 2025 AND month = 11 AND day = 5
```

Without these filters, Athena will scan all partitions, which:
- Increases query time
- Increases costs
- May fail for large datasets

### Query Costs

- Athena charges $5 per TB of data scanned
- Partition filters significantly reduce data scanned
- Query results in S3 incur standard S3 storage costs
- Results are automatically deleted after 30 days

### Data Availability

- Events are buffered by Firehose (up to 60 seconds or 5 MB)
- There may be a slight delay before new events are queryable
- Partition projection makes partitions immediately available

## Monitoring

### CloudWatch Metrics

The Athena workgroup publishes metrics to CloudWatch:
- Query execution time
- Data scanned per query
- Query success/failure rates

### Firehose Monitoring

Monitor Firehose delivery:
- Check `firehose_errors/` prefix in S3 for failed events
- Review CloudWatch Logs for Firehose delivery stream
- Monitor `DeliveryToS3.Success` metric

## Maintenance

### Data Retention

Consider implementing S3 lifecycle policies for the event data bucket:

```hcl
resource "aws_s3_bucket_lifecycle_configuration" "event_data" {
  bucket = aws_s3_bucket.event_data_bucket.id

  rule {
    id     = "archive-old-events"
    status = "Enabled"

    transition {
      days          = 90
      storage_class = "GLACIER"
    }

    expiration {
      days = 365
    }
  }
}
```

### Query Results Cleanup

Athena query results are automatically cleaned up after 30 days (configured in `glue.tf`).

### Schema Evolution

If event schemas change:
1. Update the Glue table schema in `glue.tf`
2. Apply Terraform changes
3. Old data remains queryable with the new schema (JSON is flexible)

## Security Considerations

1. **S3 Bucket Encryption**: Both event data and results buckets use SSE-S3
2. **Public Access**: Blocked on all S3 buckets
3. **IAM Roles**: Follow least-privilege principle
4. **Query Results**: Encrypted at rest in S3
5. **Access Control**: Use IAM policies to control Athena access
6. **Cross-Account Access**: Power BI role (`arn:aws:iam::545438366811:role/Power-BI`) has read-only access to event data and Glue catalog

## Cross-Account Access

The setup includes cross-account access for Power BI (AWS account 545438366811):

- **S3 Bucket Policies**: Allow Power BI role to read event data and write query results
- **Glue Resource Policy**: Allow Power BI role to access catalog metadata
- **Documentation**: See `POWER_BI_ACCESS.md` for complete setup instructions

The Power BI team needs to attach additional IAM policies to their role to complete the setup. See `POWER_BI_ACCESS.md` for details.

## Troubleshooting

### No Data Returned

**Problem**: Queries return no results

**Solutions**:
1. Verify events are being written to S3
2. Check partition values match your query filters
3. Ensure Firehose is processing events successfully
4. Check `firehose_errors/` for delivery failures

### Query Errors

**Problem**: "HIVE_CURSOR_ERROR" or "HIVE_BAD_DATA"

**Solutions**:
1. Check JSON format in S3 files
2. Verify schema matches actual data
3. Check for malformed JSON records

### Slow Queries

**Problem**: Queries take a long time to complete

**Solutions**:
1. Add partition filters (`WHERE year = ... AND month = ... AND day = ...`)
2. Select only needed columns instead of `SELECT *`
3. Reduce the date range in your query
4. Consider aggregating data into summary tables

## Additional Resources

- **ATHENA_USAGE.md**: Comprehensive query examples and best practices
- [AWS Athena Documentation](https://docs.aws.amazon.com/athena/)
- [AWS Glue Documentation](https://docs.aws.amazon.com/glue/)
- [Partition Projection](https://docs.aws.amazon.com/athena/latest/ug/partition-projection.html)
- [Firehose Dynamic Partitioning](https://docs.aws.amazon.com/firehose/latest/dev/dynamic-partitioning.html)

## Next Steps

1. **Apply the Terraform changes** to create the resources
2. **Wait for events** to start flowing through the system
3. **Test queries** using the examples in ATHENA_USAGE.md
4. **Set up CloudWatch alarms** for monitoring query performance
5. **Create views** for commonly used queries
6. **Build dashboards** using QuickSight or other BI tools
