import { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const s3 = new S3Client({});
const BUCKET_NAME = process.env.EVIDENCE_BUCKET_NAME!;
const TABLE_NAME = process.env.CASE_TABLE_NAME!;
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ALLOWED_ORIGIN = process.env.FRONTEND_URL || '*';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 
        },
        body: JSON.stringify({ message: 'Missing request body' }),
      };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(event.body);
    } catch {
      return {
        statusCode: 400,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 
        },
        body: JSON.stringify({ message: 'Invalid JSON body' }),
      };
    }

    const key = parsed.key as string;
    const caseToken = parsed.caseToken as string | undefined;
    if (!key || typeof key !== 'string') {
      return {
        statusCode: 400,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 
        },
        body: JSON.stringify({ message: 'Missing or invalid "key" field' }),
      };
    }

    const allowedPrefixes = ['packets/', 'evidence/'];
    const hasAllowedPrefix = allowedPrefixes.some((prefix) => key.startsWith(prefix));
    if (!hasAllowedPrefix) {
      return {
        statusCode: 403,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 
        },
        body: JSON.stringify({ message: 'Access denied for requested object' }),
      };
    }

    const packetMatch = key.match(/^packets\/([^/]+)\/letter\.pdf$/);
    if (packetMatch) {
      const caseId = packetMatch[1];
      const caseResult = await dynamo.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { caseId } })
      );
      const item = caseResult.Item;
      if (!item) {
        return {
          statusCode: 404,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 
          },
          body: JSON.stringify({ message: 'Case not found' }),
        };
      }

      const paymentStatus = (item as any).paymentStatus as string | undefined;
      if (paymentStatus !== 'PAID') {
        return {
          statusCode: 402,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 
          },
          body: JSON.stringify({ message: 'Payment required to download packet' }),
        };
      }
      const caseSecret = (item as any).caseSecret as string | undefined;
      if (!caseSecret || caseToken !== caseSecret) {
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
    const evidenceMatch = key.match(/^evidence\/([^/]+)\/.+$/);
    if (evidenceMatch) {
      const caseId = evidenceMatch[1];
      const caseResult = await dynamo.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { caseId } })
      );
      if (!caseResult.Item) {
        return {
          statusCode: 404,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 
          },
          body: JSON.stringify({ message: 'Case not found' }),
        };
      }
      const caseSecret = (caseResult.Item as any).caseSecret as string | undefined;
      if (!caseSecret || caseToken !== caseSecret) {
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

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const url = await getSignedUrl(s3, command, { expiresIn: 300 }); // 5 minutes

    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN, // <--- THIS IS THE FIX
      },
      body: JSON.stringify({ url }),
    };
  } catch (err) {
    console.error('Error generating download URL', err);
    return {
      statusCode: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN, // <--- Add here too for errors
      },
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
};
