# Event bus for text generation events
resource "aws_cloudwatch_event_bus" "txt_cleanup_bus" {
  name        = local.stack_id
  description = "Event Bus for Bedrock Text Cleanup Events"
}

# Archive for Text Cleanup Event Bus
resource "aws_cloudwatch_event_archive" "txt_cleanup_event_archive" {
  name             = "text-cleanup-event-archive"
  event_source_arn = aws_cloudwatch_event_bus.txt_cleanup_bus.arn
  retention_days   = 45
}

# Rule to forward events to Firehose
resource "aws_cloudwatch_event_rule" "event_to_firehose" {
  name           = "txtcleanup-event-to-firehose-rule"
  description    = "Event Rule for Bedrock Text Cleanup Events"
  event_bus_name = aws_cloudwatch_event_bus.txt_cleanup_bus.name
  event_pattern  = <<EOF
{
  "source": [
    "skynet.bedrock.application"
  ],
  "detail-type": [
    "TextGenerationEvent",
    "TextFeedbackEvent"
  ]
}
  EOF
}

# Target for Text Cleanup Rule - Firehose
resource "aws_cloudwatch_event_target" "firehose_target" {
  rule           = aws_cloudwatch_event_rule.event_to_firehose.name
  event_bus_name = aws_cloudwatch_event_bus.txt_cleanup_bus.name
  arn            = aws_kinesis_firehose_delivery_stream.event_firehose.arn
  role_arn       = data.aws_iam_role.stack.arn
}