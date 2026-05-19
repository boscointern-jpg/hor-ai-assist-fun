data "aws_vpc" "main" {
  tags = {
    Name = "fb-vpc"
  }
}

# Get private subnets based on tier tag
data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.main.id]
  }

  tags = {
    "tier" = "private"
  }
}

data "aws_subnets" "public" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.main.id]
  }

  tags = {
    "tier" = "public"
  }
}

variable "environment" {
  description = "friendly environment name for aws account dev, qa, staging, prod"
  type        = string
}

# variable "git_sha" {
#   description = "Git commit SHA"
#   type        = string
#   default     = ""
# }

variable "region" {
  description = "The AWS region"
  type        = string
  default     = "us-west-2"
}

variable "certificate_domain_name" {
  type        = string
  description = "Domain name on ACM certificate"
}

data "aws_acm_certificate" "found_cert" {
  domain      = var.certificate_domain_name
  statuses    = ["ISSUED"]
  most_recent = true
}

data "aws_route53_zone" "route53_zone" {
  name = var.certificate_domain_name
}

variable "domain" {
  type        = string
  description = "Custom domain name for the stack API Gateway"
}
