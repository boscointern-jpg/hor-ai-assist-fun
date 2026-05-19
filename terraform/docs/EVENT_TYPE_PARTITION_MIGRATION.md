# Event Type Partition Migration Guide

## Overview

The Glue tables and Kinesis Firehose have been updated to include an `event_type` partition. This change separates TextGenerationEvent and TextFeedbackEvent data into distinct S3 prefixes, preventing both event types from appearing in both tables.

## What Changed

### Before
```
S3 Structure:
s3://bucket/year=2025/month=11/day=05/
  ├── generation-event-1.json
  ├── feedback-event-1.json
  └── generation-event-2.json

Problem: Both tables read from the same location, so both event types appeared in both tables.
```

### After
```
S3 Structure:
s3://bucket/event_type=TextGenerationEvent/year=2025/month=11/day=05/
  ├── generation-event-1.json
  └── generation-event-2.json

s3://bucket/event_type=TextFeedbackEvent/year=2025/month=11/day=05/
  └── feedback-event-1.json

Solution: Events are separated by type, each table only reads its specific event type.
```

## Changes Made

### 1. Kinesis Firehose (`kinesis.tf`)

**Updated JQ Query**:
```json
{
  "event_type": ".[\"detail-type\"]",
  "year": ".time[0:4]",
  "month": ".time[5:7]",
  "day": ".time[8:10]"
}
```

**Updated S3 Prefix**:
```
event_type=!{partitionKeyFromQuery:event_type}/year=!{partitionKeyFromQuery:year}/month=!{partitionKeyFromQuery:month}/day=!{partitionKeyFromQuery:day}/
```

### 2. Glue Tables (`glue.tf`)

Both tables now include:

**Added Partition**:
```hcl
partition_keys {
  name = "event_type"
  type = "string"
}
```

**Text Generation Events Table**:
- Partition projection: `event_type` enum = `"TextGenerationEvent"`
- Location: `s3://bucket/event_type=${event_type}/year=${year}/month=${month}/day=${day}/`

**Text Feedback Events Table**:
- Partition projection: `event_type` enum = `"TextFeedbackEvent"`
- Location: `s3://bucket/event_type=${event_type}/year=${year}/month=${month}/day=${day}/`

## Migration Steps

### Step 1: Apply Terraform Changes

```bash
cd terraform
terraform plan
terraform apply
```

This will:
- Update the Firehose delivery stream with new partitioning
- Update both Glue tables with event_type partition
- Start writing new events to the correct partitions

### Step 2: Handle Existing Data (If Any)

If you already have data in the old partition structure, you have two options:

#### Option A: Leave Old Data in Place (Recommended for Testing)

Old data won't be visible in the updated tables since they now point to the `event_type=*/` prefix. This is acceptable if:
- You're still in development/testing phase
- The existing data is test data
- You want a clean start with the new structure

#### Option B: Migrate Existing Data

If you need to keep existing data, you'll need to move it to the new partition structure:

**1. Identify existing data**:
```bash
aws s3 ls s3://wor-aitxtcleanup-fun-data-lake-{account-id}-{region}/ --recursive | grep -v "event_type="
```

**2. For each file, determine its event type and move it**:

You can use a script like this:

```bash
#!/bin/bash

BUCKET="wor-aitxtcleanup-fun-data-lake-${ACCOUNT_ID}-${REGION}"

# List files in old structure
aws s3 ls s3://${BUCKET}/year=2025/ --recursive | grep -v "event_type=" | while read -r line; do
  # Extract file path
  FILE_PATH=$(echo "$line" | awk '{print $4}')

  # Download file
  aws s3 cp "s3://${BUCKET}/${FILE_PATH}" /tmp/temp_event.json

  # Extract event type
  EVENT_TYPE=$(jq -r '."detail-type"' /tmp/temp_event.json)

  # Construct new path
  # Extract year, month, day from original path
  YEAR=$(echo "$FILE_PATH" | grep -oP 'year=\K[0-9]+')
  MONTH=$(echo "$FILE_PATH" | grep -oP 'month=\K[0-9]+')
  DAY=$(echo "$FILE_PATH" | grep -oP 'day=\K[0-9]+')
  FILE_NAME=$(basename "$FILE_PATH")

  NEW_PATH="event_type=${EVENT_TYPE}/year=${YEAR}/month=${MONTH}/day=${DAY}/${FILE_NAME}"

  # Copy to new location
  aws s3 cp /tmp/temp_event.json "s3://${BUCKET}/${NEW_PATH}"

  echo "Migrated: ${FILE_PATH} -> ${NEW_PATH}"
done

# Clean up temp file
rm -f /tmp/temp_event.json
```

**3. Verify migration**:
```bash
# Check new structure
aws s3 ls s3://${BUCKET}/event_type=TextGenerationEvent/ --recursive
aws s3 ls s3://${BUCKET}/event_type=TextFeedbackEvent/ --recursive
```

**4. Test queries in Athena**:
```sql
-- Test text generation events
SELECT COUNT(*) FROM text_generation_events
WHERE event_type = 'TextGenerationEvent'
  AND year = 2025;

-- Test feedback events
SELECT COUNT(*) FROM text_feedback_events
WHERE event_type = 'TextFeedbackEvent'
  AND year = 2025;
```

**5. Delete old data (optional)**:
```bash
# Only do this after verifying the migration was successful!
aws s3 rm s3://${BUCKET}/year=2025/ --recursive --exclude "event_type=*"
```

### Step 3: Update Queries

All existing queries need to be updated to include the `event_type` partition filter.

**Before**:
```sql
SELECT * FROM text_generation_events
WHERE year = 2025 AND month = 11 AND day = 5;
```

**After**:
```sql
SELECT * FROM text_generation_events
WHERE event_type = 'TextGenerationEvent'
  AND year = 2025 AND month = 11 AND day = 5;
```

**Note**: Due to partition projection with enum type, the `event_type` filter is technically optional (the table is already constrained to that value), but it's recommended for clarity and best practices.

### Step 4: Update Power BI / Dashboards

If you have existing Power BI reports or dashboards:

1. **Update queries** to include `event_type` filter
2. **Refresh data connections** to pick up the new partition structure
3. **Test all reports** to ensure data is loading correctly
4. **Update documentation** to reflect the new query patterns

## Validation

After migration, validate the setup:

### 1. Check Firehose is Writing to New Partitions

```bash
# Generate some test events, then check S3
aws s3 ls s3://${BUCKET}/event_type=TextGenerationEvent/year=$(date +%Y)/month=$(date +%-m)/day=$(date +%-d)/
aws s3 ls s3://${BUCKET}/event_type=TextFeedbackEvent/year=$(date +%Y)/month=$(date +%-m)/day=$(date +%-d)/
```

### 2. Verify Table Isolation in Athena

Run these queries to ensure events are properly isolated:

```sql
-- This should return ONLY TextGenerationEvent
SELECT DISTINCT "detail-type" as event_type, COUNT(*) as count
FROM text_generation_events
WHERE year = 2025 AND month = 11
GROUP BY "detail-type";

-- This should return ONLY TextFeedbackEvent
SELECT DISTINCT "detail-type" as event_type, COUNT(*) as count
FROM text_feedback_events
WHERE year = 2025 AND month = 11
GROUP BY "detail-type";
```

Expected results:
- `text_generation_events`: Should show only `TextGenerationEvent`
- `text_feedback_events`: Should show only `TextFeedbackEvent`

### 3. Test Join Queries

Verify that joins between the two tables still work:

```sql
SELECT
    g.detail.generationId,
    g.detail.inputText,
    f.detail.action
FROM text_generation_events g
LEFT JOIN text_feedback_events f
    ON g.detail.generationId = f.detail.generationId
    AND f.event_type = 'TextFeedbackEvent'
    AND f.year = 2025 AND f.month = 11 AND f.day = 5
WHERE g.event_type = 'TextGenerationEvent'
  AND g.year = 2025
  AND g.month = 11
  AND g.day = 5
LIMIT 10;
```

## Rollback Plan

If you need to rollback to the previous structure:

### 1. Revert Terraform Changes

```bash
git checkout HEAD~1 terraform/kinesis.tf terraform/glue.tf
terraform apply
```

### 2. Wait for Firehose Buffer to Flush

The Firehose buffer is 60 seconds, so wait at least 2 minutes before testing.

### 3. Verify Old Structure

```bash
aws s3 ls s3://${BUCKET}/year=$(date +%Y)/ --recursive
```

## Benefits of This Change

✅ **Event Separation**: Each table now only contains its specific event type
✅ **Better Performance**: Queries scan less data (no need to filter out wrong event types)
✅ **Clearer Data Organization**: S3 structure clearly shows what data is where
✅ **Reduced Costs**: Less data scanned = lower Athena costs
✅ **Easier Maintenance**: Separate prefixes make data lifecycle management easier
✅ **Better for Power BI**: Power BI queries are more efficient with proper partitioning

## FAQ

### Q: Do I need to include `event_type` in all my queries?

**A**: Technically no, because partition projection constrains each table to its specific event type. However, it's recommended for:
- Query clarity and self-documentation
- Consistency with other partition filters
- Future-proofing if partition projection settings change

### Q: What happens to events that don't have a `detail-type` field?

**A**: Firehose will fail to extract the partition key and write the event to the error prefix:
```
s3://bucket/firehose_errors/processing-failed/year=YYYY/month=MM/day=DD/
```

Monitor this prefix for any failed events.

### Q: Can I add more event types in the future?

**A**: Yes! To add a new event type:
1. Create a new Glue table with the appropriate schema
2. Set partition projection `event_type.values` to the new event type name
3. Firehose will automatically route events to the correct prefix based on `detail-type`

### Q: How does this affect my Athena costs?

**A**: This change **reduces** costs because:
- Queries scan only relevant partitions (no scanning of wrong event types)
- Partition pruning is more effective
- Example: A query on `text_generation_events` no longer scans any `TextFeedbackEvent` files

### Q: What if I want to query all event types together?

**A**: You can create a view that unions both tables:

```sql
CREATE OR REPLACE VIEW all_events AS
SELECT 'TextGenerationEvent' as event_type, * FROM text_generation_events
UNION ALL
SELECT 'TextFeedbackEvent' as event_type, * FROM text_feedback_events;
```

However, note that this will scan both tables, so use it sparingly.

## Support

For issues or questions about this migration:
1. Check the validation steps above
2. Review `ATHENA_USAGE.md` for updated query examples
3. Consult `GLUE_SETUP_SUMMARY.md` for architecture details
4. Check CloudWatch Logs for Firehose delivery errors

## Change History

| Date | Change |
|------|--------|
| 2025-11-05 | Added event_type partition to separate event types |
| 2025-11-05 | Updated Firehose dynamic partitioning to extract detail-type |
| 2025-11-05 | Updated Glue tables with enum partition projection for event_type |
