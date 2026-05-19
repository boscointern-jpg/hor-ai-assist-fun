import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  type InvokeModelCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import { type APIGatewayProxyEvent, type Context } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';

import {
  mockAdminAuthVars,
  mockAuthVars,
  mockBadAuthVars,
  mockEnvVars
} from './test-setup-env';

// Mock the loadRuntimeConfig function before importing the handler
jest.mock("@fullbay/idp-commonutil-node-lib", () => ({
  loadRuntimeConfig: jest.fn(() => {
    // Mock implementation that does nothing since we set env vars in test-setup-env
    return;
  })
}));

// Import the handler AFTER environment variables are set by the setup file
import * as authorizer from "../authorizer";
import { handler } from '../index';

// Create mocks
const bedrockMock = mockClient(BedrockRuntimeClient);
const eventBridgeMock = mockClient(EventBridgeClient);

// Mock console methods to avoid noise in tests
const consoleSpy = {
  log: jest.spyOn(console, 'log').mockImplementation(),
  info: jest.spyOn(console, 'info').mockImplementation(),
  error: jest.spyOn(console, 'error').mockImplementation(),
  warn: jest.spyOn(console, 'warn').mockImplementation(),
};

// Test data constants
const mockRequestId = 'test-request-id-123';
const { SHORT_SHA: mockShortSha } = mockEnvVars;
const mockModelId = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const mockGenerateRequestBody = {
  inputField: 'question',
  inputText: 'What is the capital of France?',
};

const mockFeedbackRequestBody = {
  requestId: 'test-request-456',
  generationId: 'abc123f-test-generation-id',
  action: 'ACCEPT',
  comment: 'Great response',
};

const mockBedrockResponse: Partial<InvokeModelCommandOutput> = {
  body: new TextEncoder().encode(JSON.stringify({
    id: 'msg_123',
    type: 'message',
    role: 'assistant',
    content: [{
      type: 'text',
      text: 'The capital of France is Paris.'
    }],
    model: mockModelId,
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 50,
      output_tokens: 10
    }
  })) as any
};

const mockEventBridgeResponse = {
  FailedEntryCount: 0,
  Entries: [
    {
      EventId: 'event-id-123',
    },
  ],
};

// Helper functions to verify AWS SDK calls
const expectBedrockCall = (command: any, expectedInput: any): void => {
  expect(bedrockMock.commandCalls(command)).toHaveLength(1);
  const firstCall = bedrockMock.commandCalls(command)[0];
  if (firstCall === undefined) {
    throw new Error('No Bedrock calls found');
  }
  expect(firstCall.args[0].input).toEqual(expectedInput);
};

const expectEventBridgeCall = (command: any, expectedInput: any): void => {
  expect(eventBridgeMock.commandCalls(command)).toHaveLength(1);
  const firstCall = eventBridgeMock.commandCalls(command)[0];
  if (firstCall === undefined) {
    throw new Error('No EventBridge calls found');
  }
  expect(firstCall.args[0].input).toEqual(expectedInput);
};

describe('Multi-route Lambda Handler', () => {
  let mockEvent: APIGatewayProxyEvent;
  let mockContext: Context;

  beforeEach(() => {
    // Reset mocks
    bedrockMock.reset();
    eventBridgeMock.reset();
    Object.values(consoleSpy).forEach(spy => spy.mockClear());

    jest.spyOn(authorizer, 'authorizeKey').mockClear().mockResolvedValue(mockAuthVars);

    // Mock context
    mockContext = {
      awsRequestId: mockRequestId,
      callbackWaitsForEmptyEventLoop: false,
      functionName: 'test-function',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
      logGroupName: '/aws/lambda/test-function',
      logStreamName: '2023/01/01/[$LATEST]abcdef',
      memoryLimitInMB: '128',
      //remainingTimeInMillis: () => 30000,
      done: (): void => {},
      fail: (): void => {},
      succeed: (): void => {},
      getRemainingTimeInMillis: (): number => 30000,
    };

    // Base mock event structure
    mockEvent = {
      path: '/api/v1/text-transform',
      // @ts-expect-error - testing the rawPath property as mentioned in the code
      rawPath: '/api/v1/text-transform',
      httpMethod: 'POST',
      body: JSON.stringify(mockGenerateRequestBody),
      headers: {},
      multiValueHeaders: {},
      pathParameters: null,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      requestContext: {} as any,
      resource: '',
      isBase64Encoded: false,
    };
  });

  afterEach(() => {
    // Clean up any test-specific environment variable changes
  });

  afterAll(() => {
    Object.values(consoleSpy).forEach(spy => spy.mockRestore());
  });

  describe('/api/v1/text-transform route', () => {
    beforeEach(() => {
      // @ts-expect-error - rawPath exists on HTTP API Gateway events
      mockEvent.rawPath = '/api/v1/text-transform';
      mockEvent.body = JSON.stringify(mockGenerateRequestBody);
      bedrockMock.on(InvokeModelCommand).resolves(mockBedrockResponse);
      eventBridgeMock.on(PutEventsCommand).resolves(mockEventBridgeResponse);
    });

    it('should successfully generate text', async () => {
      const result = await handler(mockEvent, mockContext);

      const responseBody = JSON.parse(result.body);
      expect(result.statusCode).toBe(200);
      expect(responseBody).toEqual({
        generationId: `${mockShortSha}-${mockRequestId}`,
        content: {
          document: 'The capital of France is Paris.'
        },
        usage: {
          input_tokens: 50,
          output_tokens: 10
        }
      });
    });

    it('should call Bedrock with correct parameters', async () => {
      await handler(mockEvent, mockContext);

      expectBedrockCall(InvokeModelCommand, expect.objectContaining({
        modelId: mockModelId,
        contentType: 'application/json',
        accept: 'application/json',
      }));

      // Verify the body contains the expected prompt structure
      const calls = bedrockMock.commandCalls(InvokeModelCommand);
      const firstCall = calls[0];
      if (firstCall === undefined) {
        throw new Error('No Bedrock calls found');
      }
      const requestBody = JSON.parse(firstCall.args[0].input.body as string);
      expect(requestBody.anthropic_version).toBe('bedrock-2023-05-31');
      expect(requestBody.max_tokens).toBe(2000);
      expect(requestBody.temperature).toBe(0.1);
      expect(requestBody.messages[0].role).toBe('user');
      expect(requestBody.messages[0].content).toContain(mockGenerateRequestBody.inputField);
      expect(requestBody.messages[0].content).toContain(mockGenerateRequestBody.inputText);
    });

    it('should send generation analytics to EventBridge', async () => {
      await handler(mockEvent, mockContext);

      expectEventBridgeCall(PutEventsCommand, expect.objectContaining({
        Entries: [
          expect.objectContaining({
            Source: 'skynet.bedrock.application',
            DetailType: 'TextGenerationEvent',
            EventBusName: 'wor-aitxtcleanup-fun',
            Detail: expect.any(String),
            Time: expect.any(Date),
          }),
        ],
      }));

      const calls = eventBridgeMock.commandCalls(PutEventsCommand);
      expect(calls).toHaveLength(1);

      const detail = calls[0]?.args[0]?.input?.Entries?.[0]?.Detail;
      expect(detail).toBeDefined();

      const generationidString = `${mockShortSha}-${mockRequestId}`;
      const parsedDetail = JSON.parse(detail ?? '{}') as Record<string, unknown>;
      expect(parsedDetail).toMatchObject({
        generationId: generationidString,
        entityId: mockAuthVars.authInfo.me.entityId,
        entityEmployeeId: mockAuthVars.authInfo.me.entityEmployeeId,
        entityLocationId: mockAuthVars.authInfo.me.entityLocationId
      });
    });

    it( 'should send generation analytics to EventBridge for Admin User', async () => {
      jest.spyOn(authorizer, 'authorizeKey').mockResolvedValue(mockAdminAuthVars);
      await handler(mockEvent, mockContext);

      expectEventBridgeCall(PutEventsCommand, expect.objectContaining({
        Entries: [
          expect.objectContaining({
            Detail: expect.any(String),
          }),
        ],
      }));

      const calls = eventBridgeMock.commandCalls(PutEventsCommand);
      expect(calls).toHaveLength(1);

      const detail = calls[0]?.args[0]?.input?.Entries?.[0]?.Detail;
      expect(detail).toBeDefined();

      const parsedDetail = JSON.parse(detail ?? '{}') as Record<string, unknown>;
      expect(parsedDetail).toMatchObject({
        entityId: mockAdminAuthVars.authInfo.adminId,
        entityEmployeeId: mockAdminAuthVars.authInfo.id,
      });
      expect(parsedDetail).not.toHaveProperty('entityLocationId');
    });

    it( 'should send generation analytics to EventBridge for missing fields', async () => {
      jest.spyOn(authorizer, 'authorizeKey').mockResolvedValue(mockBadAuthVars);
      await handler(mockEvent, mockContext);

      expectEventBridgeCall(PutEventsCommand, expect.objectContaining({
        Entries: [
          expect.objectContaining({
            Detail: expect.any(String),
          }),
        ],
      }));

      const calls = eventBridgeMock.commandCalls(PutEventsCommand);
      expect(calls).toHaveLength(1);

      const detail = calls[0]?.args[0]?.input?.Entries?.[0]?.Detail;
      expect(detail).toBeDefined();

      const parsedDetail = JSON.parse(detail ?? '{}') as Record<string, unknown>;
      expect(parsedDetail).toMatchObject({
        entityEmployeeId: mockAdminAuthVars.authInfo.id,
      });
      expect(parsedDetail).not.toHaveProperty('entityId');
      expect(parsedDetail).not.toHaveProperty('entityLocationId');
    });

    it('should return 400 for missing inputText', async () => {
      mockEvent.body = JSON.stringify({ inputField: 'question' });

      const result = await handler(mockEvent, mockContext);

      expect(result).toEqual({
        statusCode: 400,
        body: JSON.stringify({
          error: "'inputText' and 'inputField' are both required",
        }),
      });
    });

    it('should return 400 for missing inputField', async () => {
      mockEvent.body = JSON.stringify({ inputText: 'What is the capital of France?' });

      const result = await handler(mockEvent, mockContext);

      expect(result).toEqual({
        statusCode: 400,
        body: JSON.stringify({
          error: "'inputText' and 'inputField' are both required",
        }),
      });
    });

    it('should handle Bedrock client errors', async () => {
      const error = new Error('Bedrock service unavailable');
      bedrockMock.on(InvokeModelCommand).rejects(error);

      const result = await handler(mockEvent, mockContext);

      expect(result).toEqual({
        statusCode: 500,
        body: JSON.stringify({
          error: 'Bedrock model error: Bedrock service unavailable',
        }),
      });
    });

    it('should continue execution when EventBridge fails', async () => {
      const eventBridgeError = new Error('EventBridge service unavailable');
      eventBridgeMock.on(PutEventsCommand).rejects(eventBridgeError);

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(200);
      expect(consoleSpy.error).toHaveBeenCalledWith(
          'Error sending event to EventBridge: ',
          eventBridgeError
      );
    });

  });

  describe('/api/v1/text-feedback route', () => {
    beforeEach(() => {
      // @ts-expect-error - rawPath property for HTTP API Gateway
      mockEvent.rawPath = '/api/v1/text-feedback';
      mockEvent.body = JSON.stringify(mockFeedbackRequestBody);
      eventBridgeMock.on(PutEventsCommand).resolves(mockEventBridgeResponse);
    });

    it('should successfully record feedback', async () => {
      const result = await handler(mockEvent, mockContext);

      expect(result).toEqual({
        statusCode: 204,
        body: '',
      });
    });

    it('should send feedback analytics to EventBridge', async () => {
      await handler(mockEvent, mockContext);

      expectEventBridgeCall(PutEventsCommand, expect.objectContaining({
        Entries: [
          expect.objectContaining({
            Source: 'skynet.bedrock.application',
            DetailType: 'TextFeedbackEvent',
            EventBusName: 'wor-aitxtcleanup-fun',
            Detail: expect.stringContaining(`"type":"FEEDBACK"`),
            Time: expect.any(Date),
          }),
        ],
      }));
    });

    it( 'should send feedback analytics to EventBridge for Admin User', async () => {
      jest.spyOn(authorizer, 'authorizeKey').mockResolvedValue(mockAdminAuthVars);
      await handler(mockEvent, mockContext);

      expectEventBridgeCall(PutEventsCommand, expect.objectContaining({
        Entries: [
          expect.objectContaining({
            Detail: expect.any(String),
          }),
        ],
      }));

      const calls = eventBridgeMock.commandCalls(PutEventsCommand);
      expect(calls).toHaveLength(1);

      const detail = calls[0]?.args[0]?.input?.Entries?.[0]?.Detail;
      expect(detail).toBeDefined();

      const parsedDetail = JSON.parse(detail ?? '{}') as Record<string, unknown>;
      expect(parsedDetail).toMatchObject({
        type: "FEEDBACK",
        entityId: mockAdminAuthVars.authInfo.adminId,
        entityEmployeeId: mockAdminAuthVars.authInfo.id,
      });
      expect(parsedDetail).not.toHaveProperty('entityLocationId');
    });

    it( 'should send feedback analytics to EventBridge for missing fields', async () => {
      jest.spyOn(authorizer, 'authorizeKey').mockResolvedValue(mockBadAuthVars);
      await handler(mockEvent, mockContext);

      expectEventBridgeCall(PutEventsCommand, expect.objectContaining({
        Entries: [
          expect.objectContaining({
            Detail: expect.any(String),
          }),
        ],
      }));

      const calls = eventBridgeMock.commandCalls(PutEventsCommand);
      expect(calls).toHaveLength(1);

      const detail = calls[0]?.args[0]?.input?.Entries?.[0]?.Detail;
      expect(detail).toBeDefined();

      const parsedDetail = JSON.parse(detail ?? '{}') as Record<string, unknown>;
      expect(parsedDetail).toMatchObject({
        type: "FEEDBACK",
        entityEmployeeId: mockBadAuthVars.authInfo.id,
      });
      expect(parsedDetail).not.toHaveProperty('entityId');
      expect(parsedDetail).not.toHaveProperty('entityLocationId');
    });

    it('should return 400 for missing generationId', async () => {
      mockEvent.body = JSON.stringify({ action: 'ACCEPT' });

      const result = await handler(mockEvent, mockContext);

      expect(result).toEqual({
        statusCode: 400,
        body: JSON.stringify({
          error: "'generationId' and 'action' are both required",
        }),
      });
    });

    it('should return 400 for missing action', async () => {
      mockEvent.body = JSON.stringify({ generationId: 'test-id' });

      const result = await handler(mockEvent, mockContext);

      expect(result).toEqual({
        statusCode: 400,
        body: JSON.stringify({
          error: "'generationId' and 'action' are both required",
        }),
      });
    });

    it('should validate allowed actions - ACCEPT', async () => {
      mockEvent.body = JSON.stringify({
        generationId: 'test-id',
        action: 'ACCEPT',
      });

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(204);
    });

    it('should validate allowed actions - REJECT', async () => {
      mockEvent.body = JSON.stringify({
        generationId: 'test-id',
        action: 'REJECT',
      });

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(204);
    });

    it('should validate allowed actions - REVERT', async () => {
      mockEvent.body = JSON.stringify({
        generationId: 'test-id',
        action: 'REVERT',
      });

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(204);
    });

    it('should return 400 for invalid action', async () => {
      mockEvent.body = JSON.stringify({
        generationId: 'test-id',
        action: 'INVALID_ACTION',
      });

      const result = await handler(mockEvent, mockContext);

      expect(result).toEqual({
        statusCode: 400,
        body: JSON.stringify({
          error: "Invalid value for 'action' field",
        }),
      });

      expect(consoleSpy.warn).toHaveBeenCalledWith(
          expect.stringContaining('Action value not allowed'),
          expect.objectContaining({
            action: 'INVALID_ACTION',
            allowedActions: 'ACCEPT, REJECT, REVERT',
          })
      );
    });

    it('should handle case-insensitive actions', async () => {
      mockEvent.body = JSON.stringify({
        generationId: 'test-id',
        action: 'accept', // lowercase
      });

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(204);
    });

    it('should continue execution when EventBridge fails for feedback', async () => {
      const eventBridgeError = new Error('EventBridge timeout');
      eventBridgeMock.on(PutEventsCommand).rejects(eventBridgeError);

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(204);
      expect(consoleSpy.error).toHaveBeenCalledWith(
          'Error sending event to EventBridge: ',
          eventBridgeError
      );
    });
  });

  describe('Route handling', () => {
    it('should return 404 for unknown routes', async () => {
      // @ts-expect-error - rawPath property for HTTP API Gateway
      mockEvent.rawPath = '/api/v1/unknown-route';

      const result = await handler(mockEvent, mockContext);

      expect(result).toEqual({
        statusCode: 404,
        body: JSON.stringify({ error: 'Not Found' }),
      });
    });

    it('should handle missing rawPath gracefully', async () => {
      // @ts-expect-error - rawPath property for HTTP API Gateway
      mockEvent.rawPath = undefined;

      const result = await handler(mockEvent, mockContext);

      expect(result).toEqual({
        statusCode: 404,
        body: JSON.stringify({ error: 'Not Found' }),
      });
    });
  });

  describe('JSON parsing errors', () => {
    it('should return 400 for invalid JSON in text-transform route', async () => {
      // @ts-expect-error - rawPath property for HTTP API Gateway
      mockEvent.rawPath = '/api/v1/text-transform';
      mockEvent.body = '{ invalid json }';

      const result = await handler(mockEvent, mockContext);

      expect(result).toEqual({
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid JSON in request body' }),
      });
    });

    it('should return 400 for invalid JSON in text-feedback route', async () => {
      // @ts-expect-error - rawPath property for HTTP API Gateway
      mockEvent.rawPath = '/api/v1/text-feedback';
      mockEvent.body = '{ invalid json }';

      const result = await handler(mockEvent, mockContext);

      expect(result).toEqual({
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid JSON in request body' }),
      });
    });

    it('should handle empty body gracefully', async () => {
      // @ts-expect-error - rawPath property for HTTP API Gateway
      mockEvent.rawPath = '/api/v1/text-transform';
      mockEvent.body = null;

      const result = await handler(mockEvent, mockContext);

      expect(result).toEqual({
        statusCode: 400,
        body: JSON.stringify({
          error: "'inputText' and 'inputField' are both required",
        }),
      });
    });
  });

  describe('Authorization', () => {
    afterEach(() => {
      delete process.env['NO_AUTH'];
    });

    it('should return 401 when authorization fails', async () => {
      jest.spyOn(authorizer, 'authorizeKey').mockResolvedValue({ authorized: false });

      const result = await handler(mockEvent, mockContext);

      expect(result).toEqual({
        statusCode: 401,
        body: JSON.stringify({ error: 'Unauthorized' }),
      });
    });

    it('should skip the authorization check when NO_AUTH is true', async () => {
      process.env['NO_AUTH'] = 'true';
      bedrockMock.on(InvokeModelCommand).resolves(mockBedrockResponse);
      eventBridgeMock.on(PutEventsCommand).resolves(mockEventBridgeResponse);

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(200);
      expect(authorizer.authorizeKey).not.toHaveBeenCalled();
    });
  });

  describe('Logging', () => {
    beforeEach(() => {
      // @ts-expect-error - rawPath property for HTTP API Gateway
      mockEvent.rawPath = '/api/v1/text-transform';
      bedrockMock.on(InvokeModelCommand).resolves(mockBedrockResponse);
      eventBridgeMock.on(PutEventsCommand).resolves(mockEventBridgeResponse);
    });

    it('should log request details with rawPath', async () => {
      await handler(mockEvent, mockContext);

      expect(consoleSpy.info).toHaveBeenCalledWith(
          `[${mockShortSha}-${mockRequestId}] Request received`,
          expect.objectContaining({
            modelId: mockModelId,
            path: '/api/v1/text-transform',
            method: 'POST',
          })
      );
    });

    it('should log successful completion', async () => {
      await handler(mockEvent, mockContext);

      // Check that the success message was logged
      expect(consoleSpy.info).toHaveBeenCalledWith(
          expect.stringContaining(`[${mockShortSha}-${mockRequestId}] Request completed successfully`),
          expect.objectContaining({
            inputTokens: 50,
            outputTokens: 10
          })
      );
    });
  });
});