
output "current_region" {
  value = data.aws_region.primary.id
}

output "lambda_role" {
  value = data.aws_iam_role.stack.arn
}

output "account_id" {
  value = data.aws_caller_identity.current.account_id
}

output "caller_arn" {
  value = data.aws_caller_identity.current.arn
}

output "caller_user" {
  value = data.aws_caller_identity.current.user_id
}

# output "git_short_sha" {
#   value = local.git_sha
# }

output "api_gateway_url" {
  value       = aws_apigatewayv2_api.public_api.api_endpoint
  description = "Default domain URL for the API Gateway"
}

output "cloudwatch_log_group_name" {
  description = "Name of the CloudWatch log group for Bedrock"
  value       = aws_cloudwatch_log_group.bedrock_logs.name
}

output "s3_bucket_name" {
  description = "Name of the S3 bucket for Bedrock logs"
  value       = aws_s3_bucket.bedrock_logs.bucket
}

# Glue and Athena Outputs
output "glue_database_name" {
  description = "Name of the Glue database for event data"
  value       = aws_glue_catalog_database.event_data.name
}

output "text_generation_events_table" {
  description = "Name of the Glue table for text generation events"
  value       = aws_glue_catalog_table.text_generation_events.name
}

output "text_feedback_events_table" {
  description = "Name of the Glue table for text feedback events"
  value       = aws_glue_catalog_table.text_feedback_events.name
}

output "athena_workgroup_name" {
  description = "Name of the Athena workgroup for querying event data"
  value       = aws_athena_workgroup.event_data.name
}

output "athena_results_bucket" {
  description = "S3 bucket for Athena query results"
  value       = aws_s3_bucket.athena_results.bucket
}

output "event_data_bucket" {
  description = "S3 bucket containing the event data"
  value       = aws_s3_bucket.event_data_bucket.bucket
}
