
terraform {
  required_version = ">=1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.11"
    }
    awscc = {
      source  = "hashicorp/awscc"
      version = ">= 1.0.0"
    }
    external = {
      source  = "hashicorp/external"
      version = "~> 2.3"
    }
  }
}

provider "aws" {
  region = "us-west-2"
  default_tags {
    tags = local.common_tags
  }
}

provider "aws" {
  alias  = "fb-ops-log-archive-prod"
  region = var.region
  assume_role {
    role_arn     = "arn:aws:iam::905418485450:role/idp-harness-oidc"
    session_name = "${local.stack_id}-${var.environment}-terraform"
  }
  default_tags {
    tags = local.common_tags
  }
}
