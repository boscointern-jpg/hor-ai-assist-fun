  # Get the AWS accou8nt ID
  ACCOUNT_ID=$(aws sts get-caller-identity \
      --query Account \
      --output text)

  # List the Bedrock logs bucket name
  S3_BUCKET=$(aws s3 ls | grep bedrock-logs)

 # Then enable logging:
  aws bedrock put-model-invocation-logging-configuration \
    --logging-config '{
      "cloudWatchConfig": {
        "logGroupName": "/aws/bedrock/wor-aitxtcleanup-fun-dev",
        "roleArn": "arn:aws:iam::'"$ACCOUNT_ID"':role/wor-aitxtcleanup-fun-bedrock-logging-role-dev"
      },
      "s3Config": {
        "bucketName": '"$S3_BUCKET"',
        "keyPrefix": "model-invocations/"
      },
      "textDataDeliveryEnabled": true,
      "imageDataDeliveryEnabled": false,
      "embeddingDataDeliveryEnabled": false
    }'