# Glue Database for event data
resource "aws_glue_catalog_database" "event_data" {
  name        = "${local.stack_id}_event_data_${var.environment}"
  description = "Database for text generation and feedback events"

  tags = local.common_tags
}

# Glue Table for TextGenerationEvent
resource "aws_glue_catalog_table" "text_generation_events" {
  database_name = aws_glue_catalog_database.event_data.name
  name          = "text_generation_events"
  description   = "Table for text generation events from Bedrock"
  table_type    = "EXTERNAL_TABLE"

  parameters = {
    "classification"               = "json"
    "compressionType"              = "none"
    "typeOfData"                   = "file"
    "projection.enabled"           = "true"
    "projection.event_type.type"   = "enum"
    "projection.event_type.values" = "TextGenerationEvent"
    "projection.year.type"         = "integer"
    "projection.year.range"        = "2024,2030"
    "projection.month.type"        = "integer"
    "projection.month.range"       = "1,12"
    "projection.month.digits"      = "2"
    "projection.day.type"          = "integer"
    "projection.day.range"         = "1,31"
    "projection.day.digits"        = "2"
    "storage.location.template"    = "s3://${aws_s3_bucket.event_data_bucket.bucket}/event_type=$${event_type}/year=$${year}/month=$${month}/day=$${day}/"
  }

  partition_keys {
    name = "event_type"
    type = "string"
  }

  partition_keys {
    name = "year"
    type = "int"
  }

  partition_keys {
    name = "month"
    type = "int"
  }

  partition_keys {
    name = "day"
    type = "int"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.event_data_bucket.bucket}/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.openx.data.jsonserde.JsonSerDe"
      parameters = {
        "ignore.malformed.json" = "false"
        "dots.in.keys"          = "false"
        "case.insensitive"      = "true"
        "mapping"               = "true"
      }
    }

    columns {
      name = "version"
      type = "string"
    }

    columns {
      name = "id"
      type = "string"
    }

    columns {
      name = "detail-type"
      type = "string"
    }

    columns {
      name = "source"
      type = "string"
    }

    columns {
      name = "account"
      type = "string"
    }

    columns {
      name = "time"
      type = "string"
    }

    columns {
      name = "region"
      type = "string"
    }

    columns {
      name = "resources"
      type = "array<string>"
    }

    columns {
      name    = "detail"
      type    = "struct<generationId:string,type:string,entityId:int,entityEmployeeId:int,entityLocationId:int,output:struct<generationId:string,content:struct<document:string>,usage:struct<input_tokens:int,output_tokens:int>>,inputField:string,inputText:string>"
      comment = "Text generation event details"
    }
  }
}

# Glue Table for TextFeedbackEvent
resource "aws_glue_catalog_table" "text_feedback_events" {
  database_name = aws_glue_catalog_database.event_data.name
  name          = "text_feedback_events"
  description   = "Table for text feedback events"
  table_type    = "EXTERNAL_TABLE"

  parameters = {
    "classification"               = "json"
    "compressionType"              = "none"
    "typeOfData"                   = "file"
    "projection.enabled"           = "true"
    "projection.event_type.type"   = "enum"
    "projection.event_type.values" = "TextFeedbackEvent"
    "projection.year.type"         = "integer"
    "projection.year.range"        = "2024,2030"
    "projection.month.type"        = "integer"
    "projection.month.range"       = "1,12"
    "projection.month.digits"      = "2"
    "projection.day.type"          = "integer"
    "projection.day.range"         = "1,31"
    "projection.day.digits"        = "2"
    "storage.location.template"    = "s3://${aws_s3_bucket.event_data_bucket.bucket}/event_type=$${event_type}/year=$${year}/month=$${month}/day=$${day}/"
  }

  partition_keys {
    name = "event_type"
    type = "string"
  }

  partition_keys {
    name = "year"
    type = "int"
  }

  partition_keys {
    name = "month"
    type = "int"
  }

  partition_keys {
    name = "day"
    type = "int"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.event_data_bucket.bucket}/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.openx.data.jsonserde.JsonSerDe"
      parameters = {
        "ignore.malformed.json" = "false"
        "dots.in.keys"          = "false"
        "case.insensitive"      = "true"
        "mapping"               = "true"
      }
    }

    columns {
      name = "version"
      type = "string"
    }

    columns {
      name = "id"
      type = "string"
    }

    columns {
      name = "detail-type"
      type = "string"
    }

    columns {
      name = "source"
      type = "string"
    }

    columns {
      name = "account"
      type = "string"
    }

    columns {
      name = "time"
      type = "string"
    }

    columns {
      name = "region"
      type = "string"
    }

    columns {
      name = "resources"
      type = "array<string>"
    }

    columns {
      name    = "detail"
      type    = "struct<generationId:string,action:string,entityEmployeeId:int,entityLocationId:int,entityId:int,type:string>"
      comment = "Text feedback event details"
    }
  }
}

# IAM Policy for Glue Crawler
resource "aws_iam_role_policy" "glue_crawler_policy" {
  name = "${local.stack_id}-glue-crawler-policy"
  role = data.aws_iam_role.stack.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.event_data_bucket.arn,
          "${aws_s3_bucket.event_data_bucket.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "glue:*Database*",
          "glue:*Table*",
          "glue:*Partition*"
        ]
        Resource = [
          "arn:aws:glue:${local.region}:${local.aws_account_id}:catalog",
          "arn:aws:glue:${local.region}:${local.aws_account_id}:database/${aws_glue_catalog_database.event_data.name}",
          "arn:aws:glue:${local.region}:${local.aws_account_id}:table/${aws_glue_catalog_database.event_data.name}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${local.region}:${local.aws_account_id}:log-group:/aws-glue/*"
      }
    ]
  })
}

# S3 bucket for Athena query results
resource "aws_s3_bucket" "athena_results" {
  bucket = "${local.stack_id}-athena-results-${local.aws_account_id}-${var.region}"

  tags = local.common_tags
}

# Enable versioning for Athena results bucket
resource "aws_s3_bucket_versioning" "athena_results" {
  bucket = aws_s3_bucket.athena_results.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Lifecycle policy for Athena results
resource "aws_s3_bucket_lifecycle_configuration" "athena_results" {
  bucket = aws_s3_bucket.athena_results.id

  rule {
    id     = "delete-old-results"
    status = "Enabled"

    expiration {
      days = 30
    }

    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }
}

# Server-side encryption for Athena results bucket
resource "aws_s3_bucket_server_side_encryption_configuration" "athena_results" {
  bucket = aws_s3_bucket.athena_results.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Public access block for Athena results bucket
resource "aws_s3_bucket_public_access_block" "athena_results" {
  bucket = aws_s3_bucket.athena_results.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Bucket policy to allow Power BI role cross-account access to query results
resource "aws_s3_bucket_policy" "athena_results_policy" {
  bucket = aws_s3_bucket.athena_results.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowPowerBIAthenaResults"
        Effect = "Allow"
        Principal = {
          AWS = [
            "arn:aws:iam::545438366811:role/Power-BI",
            "arn:aws:iam::211125509520:role/Power-BI"
          ]
        }
        Action = [
          "s3:GetObject",
          "s3:ListBucket",
          "s3:GetBucketLocation",
          "s3:PutObject"
        ]
        Resource = [
          aws_s3_bucket.athena_results.arn,
          "${aws_s3_bucket.athena_results.arn}/*"
        ]
      }
    ]
  })
}

# Glue resource policy for cross-account access
resource "aws_glue_resource_policy" "catalog_policy" {
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowPowerBICatalogAccess"
        Effect = "Allow"
        Principal = {
          AWS = [
            "arn:aws:iam::545438366811:role/Power-BI",
            "arn:aws:iam::211125509520:role/Power-BI"
          ]
        }
        Action = [
          "glue:GetDatabase",
          "glue:GetDatabases",
          "glue:GetTable",
          "glue:GetTables",
          "glue:GetPartition",
          "glue:GetPartitions",
          "glue:BatchGetPartition"
        ]
        Resource = [
          "arn:aws:glue:${local.region}:${local.aws_account_id}:catalog",
          "arn:aws:glue:${local.region}:${local.aws_account_id}:database/${aws_glue_catalog_database.event_data.name}",
          "arn:aws:glue:${local.region}:${local.aws_account_id}:table/${aws_glue_catalog_database.event_data.name}/*"
        ]
      }
    ]
  })
}

# Athena Workgroup
resource "aws_athena_workgroup" "event_data" {
  name        = "${local.stack_id}-event-data-${var.environment}"
  description = "Workgroup for querying event data"

  configuration {
    enforce_workgroup_configuration    = true
    publish_cloudwatch_metrics_enabled = true

    result_configuration {
      output_location = "s3://${aws_s3_bucket.athena_results.bucket}/query-results/"

      encryption_configuration {
        encryption_option = "SSE_S3"
      }
    }
  }

  tags = local.common_tags
}
