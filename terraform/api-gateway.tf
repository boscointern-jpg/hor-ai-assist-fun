
# API Gateway HTTP API
resource "aws_apigatewayv2_api" "public_api" {
  name          = "${local.stack_identifier}-apigwv2"
  protocol_type = "HTTP"
  cors_configuration {
    allow_credentials = false
    allow_headers     = ["*"]
    allow_methods     = ["*"]
    allow_origins     = ["*"]
    expose_headers    = []
    max_age           = 0
  }
}

resource "aws_apigatewayv2_integration" "skynet-lambda" {
  api_id = aws_apigatewayv2_api.public_api.id

  integration_type   = "AWS_PROXY"
  integration_method = "POST"
  integration_uri    = data.aws_lambda_function.aitxtcleanup_lambda.invoke_arn

  payload_format_version = "2.0"
  connection_type        = "INTERNET"
}

resource "aws_apigatewayv2_route" "text-transform" {
  api_id    = aws_apigatewayv2_api.public_api.id
  route_key = "POST /api/v1/text-transform"
  target    = "integrations/${aws_apigatewayv2_integration.skynet-lambda.id}"
}

resource "aws_apigatewayv2_route" "text-feedback" {
  api_id    = aws_apigatewayv2_api.public_api.id
  route_key = "POST /api/v1/text-feedback"
  target    = "integrations/${aws_apigatewayv2_integration.skynet-lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.public_api.id
  name        = "$default"
  auto_deploy = true
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.skynet_api_gateway.arn
    format = jsonencode({
      requestId               = "$context.requestId"
      sourceIp                = "$context.identity.sourceIp"
      requestTime             = "$context.requestTime"
      protocol                = "$context.protocol"
      httpMethod              = "$context.httpMethod"
      resourcePath            = "$context.resourcePath"
      routeKey                = "$context.routeKey"
      status                  = "$context.status"
      responseLength          = "$context.responseLength"
      integrationError        = "$context.integration.error"
      integrationErrorMessage = "$context.integrationErrorMessage"
      integrationLatency      = "$context.integrationLatency"
      integrationStatus       = "$context.integrationStatus"
      extendedRequestId       = "$context.extendedRequestId"
      responseLatency         = "$context.responseLatency"
    })
  }
}

resource "aws_apigatewayv2_domain_name" "public_api" {
  domain_name = var.domain

  domain_name_configuration {
    certificate_arn = data.aws_acm_certificate.found_cert.arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "public_api" {
  api_id      = aws_apigatewayv2_api.public_api.id
  domain_name = aws_apigatewayv2_domain_name.public_api.id
  stage       = aws_apigatewayv2_stage.default.id
}


resource "aws_route53_record" "public_api_dns" {
  zone_id = data.aws_route53_zone.route53_zone.zone_id
  name    = var.domain
  type    = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.public_api.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.public_api.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}
