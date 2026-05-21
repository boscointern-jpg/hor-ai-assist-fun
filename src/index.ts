/* eslint-env node */
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { loadRuntimeConfig } from "@fullbay/idp-commonutil-node-lib";
import { type APIGatewayProxyEvent, type APIGatewayProxyResult, type Context } from "aws-lambda";

import { authorizeKey, type AuthZ } from "./authorizer";

const bedrockClient = new BedrockRuntimeClient();
const eventBridgeClient = new EventBridgeClient();
const allowedActions = ['ACCEPT', 'REJECT', 'REVERT'] as const;
const shortSha = process.env['SHORT_SHA'] ?? "hor-ai-assist-fun";
const MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const EVENT_BUS_NAME = "wor-aitxtcleanup-fun";
const textDecoder = new TextDecoder();

// Load runtime config once at module initialization (cold start), not on every invocation
loadRuntimeConfig();

type GeneratedResponse = {
  inputField: string;
  inputText: string;
  output: Record<string, unknown>;
  generationId: string;
  type: string;
  entityId?: number;
  entityEmployeeId?: number;
  entityLocationId?: number;
};

type Message = { role: "user" | "assistant"; content: string };

type GenerateRequestBody = {
  fields: Record<string, string>;
  messages: Message[];
  authInfo?: AuthZ;
};

interface FeedbackRequestBody {
  requestId: string;
  generationId: string;
  type?: string;
  action: string;
  comment?: string;
  entityId?: number;
  entityEmployeeId?: number;
  entityLocationId?: number;
}

type AllowedAction = typeof allowedActions[number];

// Helper functions for response creation
const createResponse = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode,
  body: JSON.stringify(body),
});

const createErrorResponse = (statusCode: number, message: string): APIGatewayProxyResult =>
    createResponse(statusCode, { error: message });

console.info(`INIT Text Cleanup Function (${shortSha})`);

/*
 Call Bedrock to generate cleaned-up text and return it.
 */
async function generateText(requestBody: GenerateRequestBody, requestId: string): Promise<APIGatewayProxyResult> {
  const { fields, messages } = requestBody;

  // Validate required fields
  if (!fields || Object.keys(fields).length === 0 || !messages || messages.length === 0) {
    console.error(`[${shortSha}-${requestId}] Missing required fields`);
    return createErrorResponse(400, "'fields' object and 'messages' array are required.");
  }

  const fieldNames = Object.keys(fields).join(', ');

  // 1. Instruct Claude to act as a data processor and return STRICT JSON
  const systemPrompt = `You are a technical assistant helping a mechanic fill out a service order.
Here are the current fields and their existing values:
${JSON.stringify(fields, null, 2)}

Instructions:
- Read the conversation history to understand the mechanic's updates.
- Update the relevant fields based on the context.
- Maintain technical details, accuracy, and proper automotive terminology.
- Be concise with clarity and completeness.

CRITICAL: You must respond ONLY with a valid JSON object containing the updated fields. 
The keys must match these exact field names: ${fieldNames}. 
Do not include any markdown formatting, explanations, or conversational text. Return ONLY raw JSON.`;

  console.info(`[${shortSha}-${requestId}] Invoking Bedrock model for Multi-Field`, {
    modelId: MODEL_ID,
    fieldCount: Object.keys(fields).length
  });

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 2000,
      temperature: 0.1,
      system: systemPrompt,
      messages: messages
    })
  });

  try {
    const startTime = Date.now();
    const response = await bedrockClient.send(command);
    const duration = Date.now() - startTime;

    console.info(`[${shortSha}-${requestId}] Bedrock model invoked successfully`, { durationMs: duration });

    const responseBody = JSON.parse(textDecoder.decode(response.body)) as {
      content: Array<{ text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    if (!responseBody.content[0]) throw new Error('No content in response');
    
    // 2. Clean and parse the JSON output from Claude (using CharCodes to bypass UI rendering bugs)
    let rawOutput = responseBody.content[0].text.trim();
    const mdBlock = String.fromCharCode(96) + String.fromCharCode(96) + String.fromCharCode(96);
    rawOutput = rawOutput.replace(new RegExp('^' + mdBlock + '(?:json)?\\n?', 'i'), '')
                         .replace(new RegExp('\\n?' + mdBlock + '$', 'i'), '')
                         .trim();
    
    let updatedFields;
    try {
      updatedFields = JSON.parse(rawOutput);
    } catch (e) {
      console.error(`[${shortSha}-${requestId}] Failed to parse Claude output as JSON. Output:`, rawOutput);
      return createErrorResponse(500, "AI returned malformed data.");
    }

    const modelResponse = {
      generationId: `${shortSha}-${requestId}`,
      content: updatedFields,
      usage: responseBody.usage
    };

    try {
      const entityId = requestBody.authInfo?.me?.entityId ?? requestBody.authInfo?.adminId;
      const entityEmployeeId = requestBody.authInfo?.me?.entityEmployeeId ?? requestBody.authInfo?.id;
      const entityLocationId = requestBody.authInfo?.me?.entityLocationId;

      await sendAnalyticsToEventBridge({
        generationId: `${shortSha}-${requestId}`,
        type: "GENERATION",
        output: modelResponse,
        inputField: "MULTI_FIELD",
        inputText: "CHAT_MODE",
        ...(entityId !== undefined && { entityId }),
        ...(entityEmployeeId !== undefined && { entityEmployeeId }),
        ...(entityLocationId !== undefined && { entityLocationId }),
      });
    } catch (error) {
      console.error(`[${shortSha}-${requestId}] Error sending analytics data to EventBridge:`, error);
    }

    return createResponse(200, modelResponse);
  } catch (error: unknown) {
    console.error(`[${shortSha}-${requestId}] Error invoking Bedrock model:`, error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return createErrorResponse(500, `Bedrock model error: ${errorMessage}`);
  }
}

/*
 Record feedback from the user about the generated text.
 */
async function recordFeedbackResponse(requestBody: FeedbackRequestBody, awsRequestId: string): Promise<APIGatewayProxyResult> {
  const {generationId, action} = requestBody;

  if (generationId === undefined || generationId === '' || action === undefined || action === '') {
    console.error(`[${shortSha}-${awsRequestId}] Missing required fields`, {
      generationId: generationId !== undefined && generationId !== '',
      action: action !== undefined && action !== '',
    });
    return createErrorResponse(
        400,
        "'generationId' and 'action' are both required"
    );
  }

  if (!allowedActions.includes(action.toUpperCase() as AllowedAction)) {
    console.warn(`[${shortSha}-${awsRequestId}] WARNING: Action value not allowed`, {
      action,
      allowedActions: allowedActions.join(', ')
    });
    return createErrorResponse(
        400,
        "Invalid value for 'action' field"
    );
  }

  try {
    // Send analytics data to EventBridge (non-blocking)
    await sendAnalyticsToEventBridge({ ...requestBody, type: "FEEDBACK" });
  } catch (error) {
    // An error sending to EventBridge shouldn't prevent a successful feedback response.
    console.error(
        `[${shortSha}-${awsRequestId}] Error sending analytics data to EventBridge:`,
        error
    );
  }

  return { statusCode: 204, body: '' };
}

// Send analytic information to EventBridge (non-blocking)
async function sendAnalyticsToEventBridge(responseEvent: GeneratedResponse | FeedbackRequestBody): Promise<void> {

  let detailType: string;
  if (responseEvent.type === "GENERATION") {
    detailType = "TextGenerationEvent";
  } else if (responseEvent.type === "FEEDBACK") {
    detailType = "TextFeedbackEvent";
  } else {
    console.error("Unsupported event type: ", responseEvent.type);
    return;
  }

  console.info(`[${responseEvent.generationId}] Sending analytics to EventBridge`, {
    detailType: detailType,
    event: JSON.stringify(responseEvent),
  });

  const params = {
    Entries: [
      {
        Source: "skynet.bedrock.application",
        DetailType: detailType,
        Detail: JSON.stringify(responseEvent),
        EventBusName: EVENT_BUS_NAME,
        Time: new Date(),
      },
    ],
  };

  // A failure to send analytics data to EventBridge shouldn't stop execution if
  // the generation was successful, so note it in the logs for further inspection.
  try {
    const ebCommand = new PutEventsCommand(params);
    const data = await eventBridgeClient.send(ebCommand);
    console.info(
        `[${responseEvent.generationId}] Successfully sent to EventBridge: `,
        data
    );
  } catch (error) {
    console.error("Error sending event to EventBridge: ", error);
  }
}

export const handler = async (
    event: APIGatewayProxyEvent,
    context: Context
): Promise<APIGatewayProxyResult> => {

  const requestId = context.awsRequestId;
  // This parameter is apparently different for whether the API Gateway is REST or HTTP.
  // It was originally set up to be event.path, but that kept coming back 'undefined' and was failing
  // the path check. When I switched it to event.rawPath, it worked but IntelliJ doesn't seem to like
  // it for some reason. Hence, the ts-expect-error flag. I assure you, this *does* work properly for the
  // current setup, no matter what IntelliJ thinks.
  // @ts-expect-error - rawPath exists on HTTP API Gateway events but not in the type definition
  const path: string = event.rawPath as string;

  let requestAuthInfo: AuthZ | undefined;

  // Allow for turning off the legacy database authorization check for performance and
  // load testing of the model specifically without impacting the legacy system.
  const noAuth = process.env['NO_AUTH'];
  if (noAuth !== undefined && noAuth === "true") {
    console.warn(`[${shortSha}-${requestId}] NO_AUTH is set to true, skipping authorization check`);
  } else {
    const authKey = event.headers['authorization'];
    const { authorized, authInfo } = await authorizeKey(authKey ?? '', requestId);
    if (!authorized) {
      console.warn(`[${shortSha}-${requestId}] Unauthorized access attempt`);
      return createErrorResponse(401, "Unauthorized");
    }
    if (authInfo !== undefined) {
      requestAuthInfo = authInfo;
    }
  }

  console.info(`[${shortSha}-${requestId}] Request received`, {
    modelId: MODEL_ID,
    path: path,
    method: event.httpMethod,
  });

  // Parse request body and validate basic JSON
  let parsedRequestBody: Record<string, unknown>;
  try {
    parsedRequestBody = (event.body !== null && event.body !== undefined) ? JSON.parse(event.body) as Record<string, unknown> : {};
    console.info(
        `[${shortSha}-${requestId}] Request parsed successfully`,
        parsedRequestBody
    );
  } catch (error) {
    console.error(
        `[${shortSha}-${requestId}] Error parsing request body:`,
        error
    );
    return createErrorResponse(400, "Invalid JSON in request body");
  }

  switch (path) {
    case '/api/v1/text-transform': {
      let generateRequestBody: GenerateRequestBody = parsedRequestBody as unknown as GenerateRequestBody;
      if (requestAuthInfo !== undefined) {
        generateRequestBody = {...generateRequestBody, authInfo: {...requestAuthInfo}}
      }
      return generateText(generateRequestBody, requestId);
    }
    case '/api/v1/text-feedback': {
      let feedbackRequestBody: FeedbackRequestBody = parsedRequestBody as unknown as FeedbackRequestBody;
      if (requestAuthInfo !== undefined) {
        const entityEmployeeId = requestAuthInfo.me?.entityEmployeeId ?? requestAuthInfo.id;
        const entityLocationId = requestAuthInfo.me?.entityLocationId;
        const entityId = requestAuthInfo.me?.entityId ?? requestAuthInfo.adminId;

        feedbackRequestBody = {
          ...feedbackRequestBody,
          ...(entityEmployeeId !== undefined && { entityEmployeeId }),
          ...(entityLocationId !== undefined && { entityLocationId }),
          ...(entityId !== undefined && { entityId })
        }
      }
      return recordFeedbackResponse(feedbackRequestBody, requestId);
    }
    default:
      return createErrorResponse(404, "Not Found");
  }
}