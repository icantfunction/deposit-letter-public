import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.CASE_TABLE_NAME!;
const ALLOWED_ORIGIN = process.env.FRONTEND_URL || '*';
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caseId = event.pathParameters?.caseId;
    const tokenHeader =
      event.headers?.['x-case-token'] ||
      event.headers?.['X-Case-Token'] ||
      event.headers?.['x-api-token'];
    const isAdmin =
      ADMIN_API_TOKEN && tokenHeader === ADMIN_API_TOKEN;

    if (!caseId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        },
        body: JSON.stringify({ message: 'Missing caseId in path' }),
      };
    }

    const result = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { caseId },
      })
    );

    if (!result.Item) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        },
        body: JSON.stringify({ message: 'Case not found' }),
      };
    }

    if (!isAdmin) {
      const caseSecret = (result.Item as any).caseSecret as string | undefined;
      if (!caseSecret || tokenHeader !== caseSecret) {
        return {
          statusCode: 401,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
          },
          body: JSON.stringify({ message: 'Unauthorized' }),
        };
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      },
      body: JSON.stringify(result.Item),
    };
  } catch (err) {
    console.error('Error getting case', err);
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
