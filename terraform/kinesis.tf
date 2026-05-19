resource "aws_kinesis_firehose_delivery_stream" "event_firehose" {
  name        = "wor-aitxtcleanup-fun-event-firehose"
  destination = "extended_s3" // Corrected: Use "extended_s3"

  extended_s3_configuration {
    role_arn           = data.aws_iam_role.stack.arn  // Should be data.aws_iam_role.stack.arn in future
    bucket_arn         = aws_s3_bucket.event_data_bucket.arn
    buffering_interval = 60             // Optional: in seconds, default 300. Min 60, Max 900.
    buffering_size     = 64             // Optional: in MBs, default 5. Min 1, Max 128.
    compression_format = "UNCOMPRESSED" // Optional: GZIP, ZIP, Snappy, HADOOP_SNAPPY or UNCOMPRESSED. Default UNCOMPRESSED.

    # Dynamic partitioning configuration for event_type/year/month/day partitions
    prefix              = "event_type=!{partitionKeyFromQuery:event_type}/year=!{partitionKeyFromQuery:year}/month=!{partitionKeyFromQuery:month}/day=!{partitionKeyFromQuery:day}/"
    error_output_prefix = "firehose_errors/!{firehose:error-output-type}/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/"

    # Enable dynamic partitioning
    dynamic_partitioning_configuration {
      enabled = true
    }

    # Configure data processing for extracting partition keys
    processing_configuration {
      enabled = true

      processors {
        type = "MetadataExtraction"

        parameters {
          parameter_name  = "JsonParsingEngine"
          parameter_value = "JQ-1.6"
        }

        parameters {
          parameter_name  = "MetadataExtractionQuery"
          parameter_value = "{event_type:(.[\"detail-type\"]),year:(.time[0:4]),month:(.time[5:7]),day:(.time[8:10])}"
        }
      }

      # Append newline delimiter between records
      processors {
        type = "AppendDelimiterToRecord"

        parameters {
          parameter_name  = "Delimiter"
          parameter_value = "\\n"
        }
      }
    }
  }
}
