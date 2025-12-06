import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.CASE_TABLE_NAME!;
const ALLOWED_ORIGIN = process.env.FRONTEND_URL || '*';
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    if (!ADMIN_API_TOKEN) {
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        },
        body: JSON.stringify({ message: 'Listing cases disabled' }),
      };
    }

    const tokenHeader =
      event.headers?.['x-api-token'] ||
      event.headers?.['X-Api-Token'] ||
      event.headers?.['x-api-key'];
    // Also accept case token header for convenience in tooling, but it must match ADMIN_API_TOKEN
    if (tokenHeader !== ADMIN_API_TOKEN) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        },
        body: JSON.stringify({ message: 'Unauthorized' }),
      };
    }

    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        Limit: 50,
      })
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        items: result.Items ?? [],
      }),
    };
  } catch (err) {
    console.error('Error listing cases', err);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      },
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
};
