import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.CASE_TABLE_NAME!;
const ALLOWED_ORIGIN = process.env.FRONTEND_URL || '*';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const now = new Date().toISOString();
    const body = event.body ? JSON.parse(event.body) : {};

    const caseId = randomUUID();
    const caseSecret = randomUUID();

    const item = {
      caseId,
      caseSecret,
      createdAt: now,
      updatedAt: now,
      tenantName: body.tenantName ?? null,
      propertyAddress: body.propertyAddress ?? null,
      stateCode: body.stateCode ?? null,
      scenario: body.scenario ?? null,
      moveOutDate: body.moveOutDate ?? null,
      letterSendDate: body.letterSendDate ?? null,
      depositAmount: body.depositAmount ?? null,
      deductions: body.deductions ?? [],
      risk: body.risk ?? null,
      evidenceIndex: body.evidenceIndex ?? [],
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    );

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'OPTIONS,POST',
      },
      body: JSON.stringify({ caseId, caseSecret }),
    };
  } catch (err) {
    console.error('Error creating case', err);
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
