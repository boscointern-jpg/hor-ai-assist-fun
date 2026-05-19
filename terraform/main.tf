data "aws_caller_identity" "current" {}
data "aws_region" "primary" {}
data "aws_iam_role" "stack" {
  name = local.stack_id
}

data "external" "git_sha" {
  program = ["bash", "-c", "echo '{\"sha\":\"'$(git rev-parse --short HEAD)'\"}'"]
}

# Lookup the Lambda function by name
data "aws_lambda_function" "aitxtcleanup_lambda" {
  function_name = local.stack_id
}

# Lookup the Live Alias for the Lambda function
data "aws_lambda_alias" "telemetry_lambda_live" {
  name          = "live"
  function_name = data.aws_lambda_function.aitxtcleanup_lambda.function_name
}

locals {
  stack_id = "wor-aitxtcleanup-fun"
  region   = data.aws_region.primary.id
  #git_sha = var.git_sha != "" ? var.git_sha : try(data.external.git_sha.result.sha, "unknown")
  aws_account_id   = data.aws_caller_identity.current.account_id
  stack_identifier = "wor-aitxtcleanup-fun"
  flowName         = "7QQ2MB7081"
  aliasName        = "WAXCE121OP"

  common_tags = {
    env        = var.environment
    repo       = local.stack_id
    repoFolder = "${local.stack_id}/terraform"
    createdBy  = "terraform"
    #shortSha    = var.git_sha != "" ? var.git_sha : try(data.external.git_sha.result.sha, "unknown")
    # lastUpdated = timestamp()
  }
}
