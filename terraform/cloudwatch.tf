
resource "aws_cloudwatch_log_group" "aitxtcleanup_lambda_logs" {
  name              = "/aws/lambda/${data.aws_lambda_function.aitxtcleanup_lambda.function_name}"
  retention_in_days = 5
}

# CloudWatch Log Group for Bedrock logs
resource "aws_cloudwatch_log_group" "bedrock_logs" {
  name              = "/aws/bedrock/${local.stack_id}-${var.environment}"
  retention_in_days = 30

  tags = local.common_tags
}


resource "aws_cloudwatch_log_group" "skynet_api_gateway" {
  name              = "/aws/apigateway/${data.aws_caller_identity.current.account_id}/${aws_apigatewayv2_api.public_api.name}"
  retention_in_days = 60
}

# CloudWatch Dashboard for Bedrock Model Metrics
resource "aws_cloudwatch_dashboard" "bedrock_metrics" {
  provider       = aws.fb-ops-log-archive-prod
  dashboard_name = "${local.stack_id}-bedrock-metrics-${var.environment}"

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/Bedrock", "InputTokenCount", "ModelId", "us.anthropic.claude-haiku-4-5-20251001-v1:0",
            { stat = "Sum", label = "Total Input Tokens", accountId = data.aws_caller_identity.current.account_id }],
            [".", ".", ".", ".", { stat = "Average", label = "Avg Input Tokens per Request",
            accountId = data.aws_caller_identity.current.account_id }]
          ]
          region = local.region
          title  = "Input Token Usage"
          period = 300
          stat   = "Sum"
          yAxis = {
            left = {
              label = "Tokens"
            }
          }
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/Bedrock", "OutputTokenCount", "ModelId",
              "us.anthropic.claude-haiku-4-5-20251001-v1:0", { stat = "Sum", label = "Total Output Tokens",
            accountId = data.aws_caller_identity.current.account_id }],
            [".", ".", ".", ".", { stat = "Average", label = "Avg Output Tokens per Response",
            accountId = data.aws_caller_identity.current.account_id }]
          ]
          region = local.region
          title  = "Output Token Usage"
          period = 300
          stat   = "Sum"
          yAxis = {
            left = {
              label = "Tokens"
            }
          }
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/Bedrock", "InputTokenCount", "ModelId", "us.anthropic.claude-haiku-4-5-20251001-v1:0",
            { stat = "Sum", label = "Input Tokens", id = "m1", accountId = data.aws_caller_identity.current.account_id }],
            [".", "OutputTokenCount", ".", ".", { stat = "Sum", label = "Output Tokens", id = "m2",
            accountId = data.aws_caller_identity.current.account_id }]
          ]
          region = local.region
          title  = "Combined Token Usage"
          period = 300
          stat   = "Sum"
          yAxis = {
            left = {
              label = "Tokens"
            }
          }
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/Bedrock", "Invocations", "ModelId", "us.anthropic.claude-haiku-4-5-20251001-v1:0", {
            stat = "Sum", label = "Total Invocations", accountId = data.aws_caller_identity.current.account_id }]
          ]
          region = local.region
          title  = "Model Invocations"
          period = 300
          stat   = "Sum"
          yAxis = {
            left = {
              label = "Count"
            }
          }
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/Bedrock", "InvocationLatency", "ModelId",
            "us.anthropic.claude-haiku-4-5-20251001-v1:0", { stat = "Average", label = "Avg Latency" }],
            ["...", { stat = "Maximum", label = "Max Latency", accountId = data.aws_caller_identity.current.account_id }],
            ["...", { stat = "p99", label = "p99 Latency", accountId = data.aws_caller_identity.current.account_id }]
          ]
          region = local.region
          title  = "Model Invocation Latency"
          period = 300
          yAxis = {
            left = {
              label = "Milliseconds"
            }
          }
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            [{ expression = "m1 + m2", label = "Total Tokens", id = "e1" }],
            ["AWS/Bedrock", "InputTokenCount", "ModelId", "us.anthropic.claude-haiku-4-5-20251001-v1:0",
            { stat = "Sum", visible = false, id = "m1", accountId = data.aws_caller_identity.current.account_id }],
            [".", "OutputTokenCount", ".", ".", { stat = "Sum", visible = false, id = "m2",
            accountId = data.aws_caller_identity.current.account_id }]
          ]
          region = local.region
          title  = "Total Token Count (Input + Output)"
          period = 300
          yAxis = {
            left = {
              label = "Tokens"
            }
          }
        }
      }
    ]
  })
}

# Optional: CloudWatch Alarms for token usage thresholds
resource "aws_cloudwatch_metric_alarm" "high_token_usage" {
  provider            = aws.fb-ops-log-archive-prod
  alarm_name          = "${local.stack_id}-high-token-usage-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "InputTokenCount"
  namespace           = "AWS/Bedrock"
  period              = 300
  statistic           = "Sum"
  threshold           = 100000 # Adjust based on your needs
  alarm_description   = "Triggers when input token usage is high"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ModelId = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
  }

  tags = local.common_tags
}

resource "aws_cloudwatch_dashboard" "token_usage_insights" {
  provider       = aws.fb-ops-log-archive-prod
  dashboard_name = "${local.stack_id}-token-usage-insights-${var.environment}"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "log"
        x      = 0
        y      = 0
        width  = 24
        height = 6
        properties = {
          title  = "Token Usage by Entity ID"
          region = local.region
          query  = <<-EOQ
              SOURCE 'arn:aws:logs:us-west-2:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/wor-aitxtcleanup-fun'
              | fields @timestamp, @message
              | filter @message like /Sending analytics to EventBridge/
              | parse @message /entityId":(?<entityId>\d+)/
              | parse @message /input_tokens":(?<inputTokens>\d+)/
              | parse @message /output_tokens":(?<outputTokens>\d+)/
              | stats sum(inputTokens) as totalInputTokens,
                      sum(outputTokens) as totalOutputTokens,
                      sum(inputTokens + outputTokens) as totalTokens,
                      totalInputTokens / 1000 * 0.003 as inputCost,
                      totalOutputTokens / 1000 * 0.015 as outputCost,
                      inputCost + outputCost as totalCost,
                      count() as invocationCount
                by entityId
              | sort totalTokens desc
            EOQ
        }
      },
      {
        type   = "log"
        x      = 0
        y      = 6
        width  = 24
        height = 6
        properties = {
          title  = "Token Usage by Entity Employee ID"
          region = local.region
          query  = <<-EOQ
          SOURCE 'arn:aws:logs:us-west-2:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/wor-aitxtcleanup-fun'
          | fields @timestamp, @message
          | filter @message like /Sending analytics to EventBridge/
          | parse @message /entityEmployeeId":(?<entityEmployeeId>\d+)/
          | parse @message /entityId":(?<entityId>\d+)/
          | parse @message /input_tokens":(?<inputTokens>\d+)/
          | parse @message /output_tokens":(?<outputTokens>\d+)/
          | stats sum(inputTokens) as totalInputTokens,
                  sum(outputTokens) as totalOutputTokens,
                  sum(inputTokens + outputTokens) as totalTokens,
                  count() as invocationCount
            by entityEmployeeId, entityId
          | sort totalTokens desc
        EOQ
        }
      },
      {
        type   = "log"
        x      = 0
        y      = 12
        width  = 24
        height = 8
        properties = {
          title  = "Detailed Token Usage by Request"
          region = local.region
          query  = <<-EOQ
              SOURCE 'arn:aws:logs:us-west-2:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/wor-aitxtcleanup-fun'
              | filter @message like /Sending analytics to EventBridge/
              | parse @message /entityId":(?<entityId>\d+)/
              | parse @message /entityEmployeeId":(?<entityEmployeeId>\d+)/
              | parse @message /entityLocationId":(?<entityLocationId>\d+)/
              | parse @message /input_tokens":(?<inputTokens>\d+)/
              | parse @message /output_tokens":(?<outputTokens>\d+)/
              | parse @message /generationId":"(?<generationId>[^"]+)/
              | parse @message /inputField":"(?<inputField>[^"]+)/
              | display @timestamp, entityId, entityEmployeeId, entityLocationId, generationId, inputField, inputTokens, outputTokens, inputTokens + outputTokens as totalTokens
              | sort @timestamp desc
            EOQ
        }
      },
      {
        type   = "log"
        x      = 0
        y      = 20
        width  = 24
        height = 8
        properties = {
          title  = "Token Usage Over Time (Hourly by Entity)"
          region = local.region
          query  = <<-EOQ
              SOURCE 'arn:aws:logs:us-west-2:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/wor-aitxtcleanup-fun'
              | fields @timestamp, @message
              | filter @message like /Sending analytics to EventBridge/
              | parse @message /entityId":(?<entityId>\d+)/
              | parse @message /input_tokens":(?<inputTokens>\d+)/
              | parse @message /output_tokens":(?<outputTokens>\d+)/
              | stats sum(inputTokens) as totalInputTokens,
                      sum(outputTokens) as totalOutputTokens,
                      sum(inputTokens + outputTokens) as totalTokens,
                      count() as invocationCount
                by bin(@timestamp, 1h) as timeWindow, entityId
              | sort timeWindow desc, totalTokens desc
            EOQ
        }
      },
      {
        type   = "log"
        x      = 0
        y      = 28
        width  = 24
        height = 8
        properties = {
          title  = "Token Usage Over Time (Daily by Entity)"
          region = local.region
          query  = <<-EOQ
              SOURCE 'arn:aws:logs:us-west-2:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/wor-aitxtcleanup-fun'
              | fields @timestamp, @message
              | filter @message like /Sending analytics to EventBridge/
              | parse @message /entityId":(?<entityId>\d+)/
              | parse @message /input_tokens":(?<inputTokens>\d+)/
              | parse @message /output_tokens":(?<outputTokens>\d+)/
              | stats sum(inputTokens) as totalInputTokens,
                      sum(outputTokens) as totalOutputTokens,
                      sum(inputTokens + outputTokens) as totalTokens,
                      count() as invocationCount
                by bin(@timestamp, 1d) as timeWindow, entityId
              | sort timeWindow desc, totalTokens desc
            EOQ
        }
      },
      {
        type   = "log"
        x      = 0
        y      = 36
        width  = 24
        height = 8
        properties = {
          title  = "Token Usage Over Time (Weekly by Entity)"
          region = local.region
          query  = <<-EOQ
              SOURCE 'arn:aws:logs:us-west-2:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/wor-aitxtcleanup-fun'
              | fields @timestamp, @message
              | filter @message like /Sending analytics to EventBridge/
              | parse @message /entityId":(?<entityId>\d+)/
              | parse @message /input_tokens":(?<inputTokens>\d+)/
              | parse @message /output_tokens":(?<outputTokens>\d+)/
              | stats sum(inputTokens) as totalInputTokens,
                      sum(outputTokens) as totalOutputTokens,
                      sum(inputTokens + outputTokens) as totalTokens,
                      count() as invocationCount
                by bin(@timestamp, 1w) as timeWindow, entityId
              | sort timeWindow desc, totalTokens desc
            EOQ
        }
      }
    ]
  })
}

# Output the dashboard URL for easy access
output "token_usage_insights_dashboard_url" {
  description = "URL to the Token Usage Insights CloudWatch Dashboard"
  value       = "https://console.aws.amazon.com/cloudwatch/home?region=${local.region}#dashboards:name=${aws_cloudwatch_dashboard.token_usage_insights.dashboard_name}"
}
