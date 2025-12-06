import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.CASE_TABLE_NAME!;
const SECRET_NAME = process.env.STRIPE_SECRET_NAME || 'stripe/secret-key';
const ALLOWED_ORIGIN = process.env.FRONTEND_URL || '*';

const dynamo = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(dynamo);
const secrets = new SecretsManagerClient({});
let stripeClient: any | null = null;

async function getStripe() {
  if (stripeClient) return stripeClient;

  const secret = await secrets.send(
    new GetSecretValueCommand({
      SecretId: SECRET_NAME,
    })
  );

  const secretString = secret.SecretString;
  if (!secretString) {
    throw new Error('Stripe secret has no SecretString');
  }

  let key: string | undefined;

  try {
    const parsed = JSON.parse(secretString);
    const parsedKeys = Object.keys(parsed);
    console.log('Parsed secret as JSON. Keys:', parsedKeys);

    // Try common key names first
    const candidateKeys = [
      'stripe-secret-key',
      'stripeSecretKey',
      'STRIPE_SECRET_KEY',
      'apiKey',
      'secret',
      'key',
    ];

    for (const candidate of candidateKeys) {
      if (
        Object.prototype.hasOwnProperty.call(parsed, candidate) &&
        typeof parsed[candidate] === 'string' &&
        parsed[candidate].trim()
      ) {
        console.log('Using key from JSON field:', candidate);
        key = parsed[candidate].trim();
        break;
      }
    }

    // If still nothing, fall back to the first string-looking property
    if (!key) {
      const firstStringKey = parsedKeys.find(
        (k) => typeof (parsed as any)[k] === 'string'
      );
      if (firstStringKey) {
        console.log(
          'Falling back to first string field in JSON:',
          firstStringKey
        );
        key = (parsed as any)[firstStringKey].trim();
      }
    }
  } catch (e) {
    console.log('Secret is not valid JSON, using raw string as key.');
    key = secretString.trim();
  }

  if (!key) {
    throw new Error(
      'Could not resolve Stripe secret key. Checked JSON keys: stripe-secret-key, stripeSecretKey, STRIPE_SECRET_KEY, apiKey, secret, key.'
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const stripeLib = require('stripe');
  stripeClient = stripeLib(key);
  return stripeClient;
}

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

    const body = event.body ? JSON.parse(event.body) : {};
    const caseId = body.caseId as string | undefined;
    const caseToken = body.caseToken as string | undefined;

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

    const caseResult = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { caseId } })
    );
    const caseSecret = caseResult.Item?.caseSecret as string | undefined;
    if (!caseSecret || caseSecret !== caseToken) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ message: 'Unauthorized' }),
      };
    }

    const stripe = await getStripe();

    // Create a PaymentIntent for $2.00
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 200,
      currency: 'usd',
      metadata: { caseId },
      automatic_payment_methods: {
        enabled: true, // card + wallets (Apple Pay etc when eligible)
      },
    });

    console.log('Created PaymentIntent:', paymentIntent.id);

    // Mark case as PENDING in DynamoDB
    await dynamo.send(
      new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: { caseId: { S: caseId } },
        UpdateExpression: 'SET paymentStatus = :status, paymentIntentId = :pid',
        ExpressionAttributeValues: {
          ':status': { S: 'PENDING' },
          ':pid': { S: paymentIntent.id },
        },
      })
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        clientSecret: paymentIntent.client_secret,
      }),
    };
  } catch (err: any) {
    console.error('Error creating payment intent', err?.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        message: 'Internal server error (payment-intent)',
      }),
    };
  }
};
