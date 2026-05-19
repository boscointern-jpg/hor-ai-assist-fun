#!/bin/bash
FLOW_NAME="wor-aitxtcleanup-fun-bedrock-flow"
ALIAS_NAME="live"

# Get flow ID by name
FLOW_ID=$(aws bedrock-agent list-flows \
  --query "flowSummaries[?name=='$FLOW_NAME'].id" \
  --output text)

if [[ -z "$FLOW_ID" ]]; then
  echo "Flow '$FLOW_NAME' not found"
  exit 1
fi

# Deploy
aws bedrock-agent prepare-flow --flow-identifier "$FLOW_ID"
VERSION=$(aws bedrock-agent create-flow-version --flow-identifier "$FLOW_ID" --query 'version' --output text)
# Check if alias exists
# Check if alias exists
ALIAS_ID=$(aws bedrock-agent list-flow-aliases --flow-identifier "$FLOW_ID" \
   --query "flowAliasSummaries[?name=='$ALIAS_NAME'].id" --output text)

if [[ -n "$ALIAS_ID" ]]; then

  # Alias exists - update it
  aws bedrock-agent update-flow-alias \
    --flow-identifier "$FLOW_ID" \
    --alias-identifier "$ALIAS_ID" \
    --name "$ALIAS_NAME" \
    --routing-configuration flowVersion="$VERSION"
  echo "Updated existing alias '$ALIAS_NAME' to version $VERSION"
else
  # Alias doesn't exist - create it
  aws bedrock-agent create-flow-alias \
    --flow-identifier "$FLOW_ID" \
    --name "$ALIAS_NAME" \
    --routing-configuration flowVersion="$VERSION"
  echo "Created new alias '$ALIAS_NAME' pointing to version $VERSION"
fi
