# Athena Query Guide for Event Data

This guide provides instructions for querying text generation and feedback events stored in S3 using AWS Athena.

## Overview

The Terraform configuration creates:
- **Glue Database**: Catalog for event data
- **Two Glue Tables**:
  - `text_generation_events`: For TextGenerationEvent data
  - `text_feedback_events`: For TextFeedbackEvent data
- **Athena Workgroup**: Pre-configured workgroup for running queries
- **S3 Results Bucket**: Storage for query results (automatically expires after 30 days)

## Table Schemas

### Text Generation Events Table

Contains events with `detail-type = "TextGenerationEvent"`.

**Key Fields:**
- `version`, `id`, `account`, `time`, `region`, `source`
- `detail.generationId`: Unique ID for the generation
- `detail.entityId`: Entity identifier
- `detail.entityEmployeeId`: Employee identifier
- `detail.entityLocationId`: Location identifier
- `detail.inputField`: Field being processed
- `detail.inputText`: Original input text
- `detail.output.content.document`: Generated text output
- `detail.output.usage.input_tokens`: Input token count
- `detail.output.usage.output_tokens`: Output token count

**Partitioned by:** event_type, year, month, day (using partition projection for automatic discovery)

### Text Feedback Events Table

Contains events with `detail-type = "TextFeedbackEvent"`.

**Key Fields:**
- `version`, `id`, `account`, `time`, `region`, `source`
- `detail.generationId`: References the generation this feedback is for
- `detail.action`: Feedback action (e.g., "ACCEPT", "REJECT")
- `detail.entityId`: Entity identifier
- `detail.entityEmployeeId`: Employee identifier
- `detail.entityLocationId`: Location identifier

**Partitioned by:** event_type, year, month, day (using partition projection for automatic discovery)

## Example Queries

### 1. Query Recent Text Generation Events

```sql
SELECT
    time,
    detail.generationId,
    detail.entityId,
    detail.inputField,
    detail.inputText,
    detail.output.content.document as generated_text,
    detail.output.usage.input_tokens,
    detail.output.usage.output_tokens
FROM text_generation_events
WHERE event_type = 'TextGenerationEvent'
  AND year = 2025
  AND month = 11
  AND day = 4
ORDER BY time DESC
LIMIT 100;
```

### 2. Query Recent Feedback Events

```sql
SELECT
    time,
    detail.generationId,
    detail.action,
    detail.entityId,
    detail.entityEmployeeId
FROM text_feedback_events
WHERE event_type = 'TextFeedbackEvent'
  AND year = 2025
  AND month = 11
  AND day = 4
ORDER BY time DESC
LIMIT 100;
```

### 3. Join Generation Events with Feedback

```sql
SELECT
    g.time as generation_time,
    g.detail.generationId,
    g.detail.inputText,
    g.detail.output.content.document as generated_text,
    f.detail.action as feedback_action,
    f.time as feedback_time,
    g.detail.output.usage.input_tokens,
    g.detail.output.usage.output_tokens
FROM text_generation_events g
LEFT JOIN text_feedback_events f
    ON g.detail.generationId = f.detail.generationId
    AND f.event_type = 'TextFeedbackEvent'
    AND f.year = 2025 AND f.month = 11 AND f.day = 4
WHERE g.event_type = 'TextGenerationEvent'
  AND g.year = 2025
  AND g.month = 11
  AND g.day = 4
ORDER BY g.time DESC;
```

### 4. Calculate Acceptance Rate by Entity

```sql
WITH generation_counts AS (
    SELECT
        detail.entityId,
        detail.entityLocationId,
        COUNT(*) as total_generations
    FROM text_generation_events
    WHERE year = 2025 AND month = 11
    GROUP BY detail.entityId, detail.entityLocationId
),
feedback_counts AS (
    SELECT
        detail.entityId,
        detail.entityLocationId,
        detail.action,
        COUNT(*) as action_count
    FROM text_feedback_events
    WHERE year = 2025
      AND month = 11
      AND detail.action = 'ACCEPT'
    GROUP BY detail.entityId, detail.entityLocationId, detail.action
)
SELECT
    g.entityId,
    g.entityLocationId,
    g.total_generations,
    COALESCE(f.action_count, 0) as accepted_count,
    CAST(COALESCE(f.action_count, 0) AS DOUBLE) / g.total_generations * 100 as acceptance_rate_pct
FROM generation_counts g
LEFT JOIN feedback_counts f
    ON g.entityId = f.entityId
    AND g.entityLocationId = f.entityLocationId
ORDER BY acceptance_rate_pct DESC;
```

### 5. Token Usage Statistics

```sql
SELECT
    DATE(from_iso8601_timestamp(time)) as date,
    COUNT(*) as total_generations,
    SUM(detail.output.usage.input_tokens) as total_input_tokens,
    SUM(detail.output.usage.output_tokens) as total_output_tokens,
    AVG(detail.output.usage.input_tokens) as avg_input_tokens,
    AVG(detail.output.usage.output_tokens) as avg_output_tokens,
    MAX(detail.output.usage.input_tokens) as max_input_tokens,
    MAX(detail.output.usage.output_tokens) as max_output_tokens
FROM text_generation_events
WHERE year = 2025
  AND month = 11
GROUP BY DATE(from_iso8601_timestamp(time))
ORDER BY date DESC;
```

### 6. Most Common Input Fields

```sql
SELECT
    detail.inputField,
    COUNT(*) as usage_count,
    AVG(detail.output.usage.output_tokens) as avg_output_tokens
FROM text_generation_events
WHERE year = 2025
  AND month = 11
GROUP BY detail.inputField
ORDER BY usage_count DESC;
```

### 7. Events by Location and Employee

```sql
SELECT
    detail.entityLocationId,
    detail.entityEmployeeId,
    COUNT(*) as generation_count,
    SUM(detail.output.usage.input_tokens + detail.output.usage.output_tokens) as total_tokens
FROM text_generation_events
WHERE year = 2025
  AND month = 11
  AND day = 4
GROUP BY detail.entityLocationId, detail.entityEmployeeId
ORDER BY generation_count DESC;
```

### 8. Time Series Analysis (Hourly Breakdown)

```sql
SELECT
    DATE_TRUNC('hour', from_iso8601_timestamp(time)) as hour,
    COUNT(*) as event_count,
    SUM(detail.output.usage.input_tokens) as input_tokens,
    SUM(detail.output.usage.output_tokens) as output_tokens
FROM text_generation_events
WHERE year = 2025
  AND month = 11
  AND day = 4
GROUP BY DATE_TRUNC('hour', from_iso8601_timestamp(time))
ORDER BY hour;
```

### 9. Find Generations Without Feedback

```sql
SELECT
    g.time,
    g.detail.generationId,
    g.detail.inputText,
    g.detail.output.content.document as generated_text
FROM text_generation_events g
LEFT JOIN text_feedback_events f
    ON g.detail.generationId = f.detail.generationId
    AND f.year = g.year
    AND f.month = g.month
    AND f.day = g.day
WHERE g.year = 2025
  AND g.month = 11
  AND g.day = 4
  AND f.detail.generationId IS NULL
ORDER BY g.time DESC;
```

### 10. Cost Analysis (Approximate)

```sql
-- Assuming pricing model of $3 per 1M input tokens and $15 per 1M output tokens
-- (Adjust prices based on actual Claude model pricing)
SELECT
    DATE(from_iso8601_timestamp(time)) as date,
    SUM(detail.output.usage.input_tokens) as total_input_tokens,
    SUM(detail.output.usage.output_tokens) as total_output_tokens,
    SUM(detail.output.usage.input_tokens) / 1000000.0 * 3 as estimated_input_cost,
    SUM(detail.output.usage.output_tokens) / 1000000.0 * 15 as estimated_output_cost,
    (SUM(detail.output.usage.input_tokens) / 1000000.0 * 3) +
    (SUM(detail.output.usage.output_tokens) / 1000000.0 * 15) as estimated_total_cost
FROM text_generation_events
WHERE year = 2025
  AND month = 11
GROUP BY DATE(from_iso8601_timestamp(time))
ORDER BY date DESC;
```

## Using Athena

### Via AWS Console

1. Navigate to **AWS Athena** in the AWS Console
2. Select the workgroup: `wor-aitxtcleanup-fun-event-data-{environment}`
3. Choose the database from the dropdown (name available in Terraform outputs)
4. Run any of the example queries above

### Via AWS CLI

```bash
# Get the workgroup name from Terraform
WORKGROUP=$(terraform output -raw athena_workgroup_name)
DATABASE=$(terraform output -raw glue_database_name)

# Run a query
aws athena start-query-execution \
    --query-string "SELECT * FROM text_generation_events WHERE year=2025 AND month=11 AND day=4 LIMIT 10" \
    --work-group "$WORKGROUP" \
    --query-execution-context "Database=$DATABASE"
```

### Via Python (Boto3)

```python
import boto3
import time

athena = boto3.client('athena', region_name='us-west-2')

# Configuration
WORKGROUP = 'wor-aitxtcleanup-fun-event-data-{environment}'
DATABASE = '{database_name}'  # Get from Terraform outputs
QUERY = """
    SELECT
        detail.generationId,
        detail.inputText,
        detail.output.content.document
    FROM text_generation_events
    WHERE year = 2025 AND month = 11 AND day = 4
    LIMIT 10
"""

# Start query execution
response = athena.start_query_execution(
    QueryString=QUERY,
    QueryExecutionContext={'Database': DATABASE},
    WorkGroup=WORKGROUP
)

query_execution_id = response['QueryExecutionId']

# Wait for query to complete
while True:
    result = athena.get_query_execution(QueryExecutionId=query_execution_id)
    state = result['QueryExecution']['Status']['State']

    if state in ['SUCCEEDED', 'FAILED', 'CANCELLED']:
        break

    time.sleep(1)

# Get results
if state == 'SUCCEEDED':
    results = athena.get_query_results(QueryExecutionId=query_execution_id)
    for row in results['ResultSet']['Rows']:
        print([col.get('VarCharValue') for col in row['Data']])
```

## Best Practices

### 1. Always Use Partition Filters

The tables use partition projection with event_type/year/month/day partitions. **Always include these in your WHERE clause** for better performance and lower costs:

```sql
WHERE event_type = 'TextGenerationEvent'
  AND year = 2025 AND month = 11 AND day = 4
```

Note: The `event_type` filter is automatically constrained by partition projection (each table only reads its specific event type), but including it explicitly in queries is still recommended for clarity and best practices.

### 2. Limit Result Sets

Use `LIMIT` clauses when exploring data:

```sql
SELECT * FROM text_generation_events
WHERE year = 2025 AND month = 11 AND day = 4
LIMIT 100;
```

### 3. Use Column Selection

Select only the columns you need instead of using `SELECT *`:

```sql
-- Good
SELECT detail.generationId, detail.inputText
FROM text_generation_events

-- Avoid
SELECT * FROM text_generation_events
```

### 4. Query Result Lifecycle

Query results are automatically deleted after 30 days. Download important results if needed for longer retention.

### 5. Monitor Costs

- Each query scans data in S3, which incurs costs
- Use partition filters to minimize data scanned
- Monitor your Athena query costs in AWS Cost Explorer

## Troubleshooting

### No Data Returned

1. **Check partition values**: Ensure the year/month/day in your WHERE clause match the S3 path structure
2. **Verify data exists**: Check the S3 bucket to confirm events are being written
3. **Check date format**: The `time` field is an ISO 8601 string; use `from_iso8601_timestamp()` for date operations

### Query Errors

1. **Syntax errors**: Validate SQL syntax
2. **Type mismatches**: Ensure you're comparing compatible types (e.g., don't compare strings to integers)
3. **Column names with hyphens**: Use backticks for columns with special characters: `` `detail-type` ``

### Performance Issues

1. **Add partition filters**: Always filter by year/month/day
2. **Reduce date range**: Query smaller time windows
3. **Use aggregations**: Pre-aggregate data instead of querying raw events repeatedly

## Additional Resources

- [AWS Athena Documentation](https://docs.aws.amazon.com/athena/)
- [Presto SQL Functions](https://prestodb.io/docs/current/functions.html) (Athena uses Presto SQL)
- [AWS Glue Documentation](https://docs.aws.amazon.com/glue/)
