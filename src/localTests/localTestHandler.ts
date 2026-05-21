import { handler } from '../index';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';

async function main() {
  const event = {
    rawPath: '/api/v1/text-transform',
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({
      fields: {
        "Complaint": "Rear brakes grinding",
        "Cause": "Rear brake pads worn to metal; rear rotors heavily scored",
        "Correction": "Replaced rear brake pads and rotors; bled brake system"
      },
      messages: [
        { 
          role: "user", 
          content: "Customer states brakes are grinding in the rear. I inspected it and found the rear brake pads are down to the metal and the rotors are heavily scored. I replaced both rear pads and rotors and bled the system." 
        },
        {
          role: "assistant",
          content: JSON.stringify({
            "Complaint": "Rear brakes grinding",
            "Cause": "Rear brake pads worn to metal; rear rotors heavily scored",
            "Correction": "Replaced rear brake pads and rotors; bled brake system"
          })
        },
        {
          role: "user",
          content: "Actually, it was the front brakes grinding, not the rear. And add part number 56060."
        }
      ]
    })
  } as unknown as APIGatewayProxyEvent;

  const context = {
    awsRequestId: 'local-test-chat-loop'
  } as Context;

  process.env.NO_AUTH = "true";

  const response = await handler(event, context);
  console.log('AI Response Target Output:\n', JSON.stringify(JSON.parse(response.body), null, 2));
}

main().catch(console.error);