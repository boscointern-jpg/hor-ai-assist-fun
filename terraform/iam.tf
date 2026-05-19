
# IAM Policy for Bedrock Logging
resource "aws_iam_role_policy" "bedrock_logging" {
  name = "${local.stack_id}-bedrock-logging-policy-${var.environment}"
  role = data.aws_iam_role.stack.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.bedrock_logs.arn}:*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:PutObjectAcl"
        ]
        Resource = "${aws_s3_bucket.bedrock_logs.arn}/*"
      }
    ]
  })
}

## DEPRECATION NOTE: This policy is NO LONGER REQUIRED because the application no longer utilizes
## Bedrock Flow to execute the model - index.ts calls the model directly via the InvokeModelCommand.
resource "aws_iam_role_policy" "bedrock_flow_policy" {
  name = "bedrock-flow-policy"
  role = data.aws_iam_role.stack.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:ListTagsForResource"
        ]
        # Make sure that if Bedrock Flow is used again that the model ARN is set to the correct ID.
        # Claude Sonnet 3.X is no longer supported by AWS!!!
        Resource = "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0"
      }
    ]
  })
}

# Add CloudWatch Logs permissions to the Bedrock Flow role for model invocation logging
## DEPRECATION NOTE: Bedrock Flow is no longer used by the application.
resource "aws_iam_role_policy" "bedrock_flow_logging" {
  name = "bedrock-flow-logging-policy"
  role = data.aws_iam_role.stack.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.bedrock_logs.arn}:*"
      }
    ]
  })
}

# Attach a policy to the IAM role for Bedrock permissions
# This policy might still be necessary for general Bedrock model usage, verify in dev that everything
# still works before removing this.
resource "aws_iam_role_policy_attachment" "bedrock_flow_policy_attachment" {
  role       = data.aws_iam_role.stack.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonBedrockFullAccess" # Or a more granular policy
}

# IAM Policy for Bedrock model invocation
resource "aws_iam_role_policy" "lambda_consolidated_policy" {
  name = "lambda-consolidated-policy"
  role = data.aws_iam_role.stack.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock-runtime:InvokeModel",
          "bedrock:InvokeFlow",                           # Added this permission
          "bedrock-agent-runtime:InvokeFlow",             # May not be needed if not using Bedrock Flow
          "bedrock-agent-runtime:InvokeAgent",            # Added this permission
          "bedrock-runtime:InvokeFlowWithResponseStream", # Added this permission
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = data.aws_lambda_function.aitxtcleanup_lambda.function_name
  principal     = "apigateway.amazonaws.com"

  source_arn = "${aws_apigatewayv2_api.public_api.execution_arn}/*/*"
}

# Inline Policy for the wor-aitxtcleanup-fun role.  Allow the role to put events onto the EventBridge
resource "aws_iam_role_policy" "eventbridge_policy" {
  name = "aiTextCleanpuLambdaEventBridgePutMessagePolicy"
  role = data.aws_iam_role.stack.id

  policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Sid" : "VisualEditor0",
        "Effect" : "Allow",
        "Action" : [
          "events:PutEvents"
        ],
        "Resource" : aws_cloudwatch_event_bus.txt_cleanup_bus.arn
      }
    ]
  })
}

#  Inline Policy for Firehose to access S3
resource "aws_iam_role_policy" "firehose_s3_policy" {
  name = "firehose-s3-policy"
  role = data.aws_iam_role.stack.id
  policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Action" : [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:PutObject"
        ],
        "Effect" : "Allow",
        "Resource" : [
          "arn:aws:s3:::wor-aitxtcleanup-fun-data-lake-${local.aws_account_id}-${var.region}",
          "arn:aws:s3:::wor-aitxtcleanup-fun-data-lake-${local.aws_account_id}-${var.region}/*"
        ]
      }
    ]
  })
}

# Inline Policy for EventBridge to put events into Firehose
resource "aws_iam_role_policy" "eventbridge_to_firehose_inline_policy" {
  name = "EventBridgeToFirehosePutRecordPolicy"
  role = data.aws_iam_role.stack.id

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect   = "Allow",
        Action   = [
          "firehose:PutRecord",
          "firehose:PutRecordBatch"
        ],
        Resource = aws_kinesis_firehose_delivery_stream.event_firehose.arn
      }
    ]
  })
}
