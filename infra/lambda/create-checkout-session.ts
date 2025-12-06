import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const TABLE_NAME = process.env.CASE_TABLE_NAME!;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const SECRET_NAME = process.env.STRIPE_SECRET_NAME || 'stripe/secret-key';
const ALLOWED_ORIGIN = FRONTEND_URL || '*';

const dynamo = new DynamoDBClient({});
const secrets = new SecretsManagerClient({});

let stripeClient: any | null = null;

async function getStripe() {
  if (stripeClient) return stripeClient;

  console.log('Fetching Stripe secret from Secrets Manager', {
    secretName: SECRET_NAME,
  });

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
  let parsedKeys: string[] | undefined;

  try {
    const parsed = JSON.parse(secretString);
    parsedKeys = Object.keys(parsed);
    console.log('Parsed secret as JSON. Keys found:', parsedKeys);

    if ('stripe-secret-key' in parsed) {
      console.log('Using "stripe-secret-key" field from secret JSON');
      key = parsed['stripe-secret-key'];
    } else if ('stripe_secret_key' in parsed) {
      console.log('Using "stripe_secret_key" field from secret JSON');
      key = parsed['stripe_secret_key'];
    } else if (parsedKeys.length === 1) {
      console.warn(
        'No stripe-secret-key / stripe_secret_key field. Falling back to sole key:',
        parsedKeys[0]
      );
      key = parsed[parsedKeys[0]];
    }
  } catch (e) {
    console.warn(
      'SecretString is not valid JSON; treating it as a raw Stripe key. Not logging the value for security.'
    );
    key = secretString;
  }

  if (!key) {
    throw new Error(
      `Unable to locate Stripe API key in secret JSON. Available keys: ${
        parsedKeys ? parsedKeys.join(', ') : '(none/parse-failed)'
      }`
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Stripe = require('stripe');
  stripeClient = new Stripe(key, {
    apiVersion: '2024-06-20',
  });

  console.log('Stripe client initialized successfully');
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

    if (!event.body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'Missing request body' }),
      };
    }

    const parsed = JSON.parse(event.body);
    const caseId = parsed.caseId as string | undefined;

    if (!caseId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'caseId is required' }),
      };
    }

  const stripe = await getStripe();

  const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Security Deposit Defense Packet',
              description:
                'Court-ready itemized letter, timing summary, and evidence index for one tenant case.',
            },
            unit_amount: 200, // $2.00 in cents
          },
          quantity: 1,
        },
      ],
      success_url: `${FRONTEND_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}&caseId=${caseId}`,
      cancel_url: `${FRONTEND_URL}/checkout/cancel?caseId=${caseId}`,
      metadata: {
        caseId,
      },
    });

    console.log('Stripe checkout session created:', {
      id: session.id,
      url: session.url,
    });

    await dynamo.send(
      new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: { caseId: { S: caseId } },
        UpdateExpression: 'SET paymentStatus = :status, stripeSessionId = :sid',
        ExpressionAttributeValues: {
          ':status': { S: 'PENDING' },
          ':sid': { S: session.id },
        },
      })
    );

    console.log('DynamoDB updated for case', caseId);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        id: session.id,
        url: session.url,
      }),
    };
  } catch (err: any) {
    console.error('Error creating checkout session', err?.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        message: 'Internal server error (checkout-session)',
      }),
    };
  }
};
