#  S3 bucket for storing event data
resource "aws_s3_bucket" "event_data_bucket" {
  bucket = "${local.stack_id}-data-lake-${local.aws_account_id}-${var.region}"
}

# Bucket policy to allow Power BI role cross-account read access
resource "aws_s3_bucket_policy" "event_data_bucket_policy" {
  bucket = aws_s3_bucket.event_data_bucket.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowPowerBIAndStackRoleReadAccess"
        Effect = "Allow"
        Principal = {
          AWS = [
            "arn:aws:iam::545438366811:role/Power-BI",
            "arn:aws:iam::211125509520:role/Power-BI",
            data.aws_iam_role.stack.arn
          ]
        }
        Action = [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:ListBucketMultipartUploads",
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:GetBucketLocation"
        ]
        Resource = [
          aws_s3_bucket.event_data_bucket.arn,
          "${aws_s3_bucket.event_data_bucket.arn}/*"
        ]
      }
    ]
  })
}

##### BEDROCK LOGS ####
# S3 Bucket for Bedrock logs
resource "aws_s3_bucket" "bedrock_logs" {
  bucket = "${local.stack_id}-bedrock-logs-${var.environment}-${random_id.bucket_suffix.hex}"
  tags   = local.common_tags
}

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

# S3 Bucket versioning
resource "aws_s3_bucket_versioning" "bedrock_logs" {
  bucket = aws_s3_bucket.bedrock_logs.id
  versioning_configuration {
    status = "Enabled"
  }
}

# S3 Bucket server-side encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "bedrock_logs" {
  bucket = aws_s3_bucket.bedrock_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# S3 Bucket public access block
resource "aws_s3_bucket_public_access_block" "bedrock_logs" {
  bucket = aws_s3_bucket.bedrock_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
