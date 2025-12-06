import { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const BUCKET_NAME = process.env.EVIDENCE_BUCKET_NAME!;
const s3 = new S3Client({});
const TABLE_NAME = process.env.CASE_TABLE_NAME!;
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB per file
const ALLOWED_ORIGIN = process.env.FRONTEND_URL || '*';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
};

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ message: 'Method not allowed' }),
      };
    }

    if (!event.body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'Missing request body' }),
      };
    }

    const parsed = JSON.parse(event.body);
    const caseId = parsed.caseId as string | undefined;
    const caseToken = parsed.caseToken as string | undefined;
    const fileName = parsed.fileName as string | undefined;
    const contentType =
      (parsed.contentType as string | undefined) ||
      (parsed.fileType as string | undefined) ||
      'application/octet-stream';
    const fileSize = parsed.fileSize as number | undefined;

    if (!caseId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'caseId is required' }),
      };
    }
    if (!caseToken) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ message: 'caseToken is required' }),
      };
    }
    if (!fileName) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'fileName is required' }),
      };
    }
    if (!fileSize || typeof fileSize !== 'number' || fileSize <= 0 || fileSize > MAX_UPLOAD_BYTES) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: `fileSize must be > 0 and <= ${MAX_UPLOAD_BYTES} bytes` }),
      };
    }

    const allowedContentTypes = ['application/pdf'];
    const isImage = contentType.startsWith('image/');
    const isAllowed =
      isImage || allowedContentTypes.includes(contentType);
    if (!isAllowed) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'Unsupported content type' }),
      };
    }

    const caseResult = await dynamo.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { caseId } })
    );
    if (!caseResult.Item) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ message: 'Case not found' }),
      };
    }
    const caseSecret = (caseResult.Item as any).caseSecret as string | undefined;
    if (!caseSecret || caseSecret !== caseToken) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ message: 'Unauthorized' }),
      };
    }

    // Basic sanitization for S3 key
    const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const randomSuffix = Math.random().toString(36).slice(2);
    const key = `evidence/${caseId}/${Date.now()}-${randomSuffix}/${safeName}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3, command, {
      expiresIn: 900, // 15 minutes
    });

    console.log('Generated upload URL', { key });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ uploadUrl, key }),
    };
  } catch (err: any) {
    console.error('Error creating upload URL', err?.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        message: 'Internal server error (upload-url)',
      }),
    };
  }
};
