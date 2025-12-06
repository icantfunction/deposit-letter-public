import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const TABLE_NAME = process.env.CASE_TABLE_NAME!;
const WEBHOOK_SECRET_NAME =
  process.env.STRIPE_WEBHOOK_SECRET_NAME || 'stripe/webhook-secret';
const ALLOWED_ORIGIN = process.env.FRONTEND_URL || '*';

const dynamo = new DynamoDBClient({});
const secrets = new SecretsManagerClient({});
let webhookSecretCache: string | null = null;

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
};

async function getWebhookSecret(): Promise<string> {
  if (webhookSecretCache) return webhookSecretCache;

  const secret = await secrets.send(
    new GetSecretValueCommand({ SecretId: WEBHOOK_SECRET_NAME })
  );
  const secretString = secret.SecretString;

  if (!secretString) {
    throw new Error('Stripe webhook secret has no SecretString');
  }

  let resolved: string | undefined;

  try {
    const parsed = JSON.parse(secretString);
    const candidateKeys = [
      'stripe-webhook-secret',
      'stripeWebhookSecret',
      'STRIPE_WEBHOOK_SECRET',
      'webhookSecret',
      'webhook_secret',
      'secret',
      'key',
    ];
    for (const key of candidateKeys) {
      if (typeof (parsed as any)[key] === 'string' && (parsed as any)[key].trim()) {
        resolved = (parsed as any)[key].trim();
        break;
      }
    }
    if (!resolved) {
      const firstStringKey = Object.keys(parsed).find(
        (k) => typeof (parsed as any)[k] === 'string'
      );
      if (firstStringKey) {
        resolved = (parsed as any)[firstStringKey].trim();
      }
    }
  } catch {
    resolved = secretString.trim();
  }

  if (!resolved) {
    throw new Error(
      'Could not resolve Stripe webhook secret. Checked keys: stripe-webhook-secret, stripeWebhookSecret, STRIPE_WEBHOOK_SECRET, webhookSecret, webhook_secret, secret, key.'
    );
  }

  webhookSecretCache = resolved;
  return webhookSecretCache;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const signatureHeader =
      event.headers['Stripe-Signature'] ||
      event.headers['stripe-signature'] ||
      event.headers['STRIPE-SIGNATURE'];

    if (!signatureHeader) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'Missing Stripe-Signature header' }),
      };
    }

    const rawBody = event.body
      ? event.isBase64Encoded
        ? Buffer.from(event.body, 'base64')
        : Buffer.from(event.body, 'utf8')
      : Buffer.from('');

    const webhookSecret = await getWebhookSecret();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const stripeLib = require('stripe');
    const stripe = stripeLib('whsec_placeholder'); // constructEvent does not call Stripe API

    let stripeEvent: any;
    try {
      stripeEvent = stripe.webhooks.constructEvent(
        rawBody,
        signatureHeader,
        webhookSecret
      );
    } catch (verifyErr: any) {
      console.error('Stripe signature verification failed', verifyErr);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'Invalid signature' }),
      };
    }

    const type = stripeEvent.type as string | undefined;
    console.log('Stripe event type:', type);

    // Helper to mark a case with a given status
    async function markCaseStatus(
      caseId: string,
      status: string,
      extra?: Record<string, string>
    ) {
      const exprAttrValues: Record<string, any> = {
        ':status': { S: status },
      };
      let updateExpr = 'SET paymentStatus = :status';

      if (extra?.lastPaymentIntentId) {
        exprAttrValues[':piId'] = { S: extra.lastPaymentIntentId };
        updateExpr += ', lastPaymentIntentId = :piId';
      }

      await dynamo.send(
        new UpdateItemCommand({
          TableName: TABLE_NAME,
          Key: { caseId: { S: caseId } },
          UpdateExpression: updateExpr,
          ExpressionAttributeValues: exprAttrValues,
        })
      );
      console.log(`Case ${caseId} marked as ${status}`);
    }

    if (type === 'payment_intent.succeeded' || type === 'payment_intent.payment_failed') {
      const pi = stripeEvent.data?.object;
      const caseId: string | undefined = pi?.metadata?.caseId;
      const paymentIntentId: string | undefined = pi?.id;

      console.log('PaymentIntent payload:', {
        caseId,
        paymentIntentId,
        status: pi?.status,
      });

      if (!caseId) {
        console.warn('No caseId on PaymentIntent.metadata; skipping DynamoDB update.');
      } else {
        if (type === 'payment_intent.succeeded') {
          await markCaseStatus(caseId, 'PAID', {
            lastPaymentIntentId: paymentIntentId || 'unknown',
          });
        } else if (type === 'payment_intent.payment_failed') {
          await markCaseStatus(caseId, 'FAILED');
        }
      }
    } else if (type === 'checkout.session.completed') {
      // Optional: keep this in case you ever use hosted Checkout again
      const session = stripeEvent.data?.object;
      const caseId: string | undefined = session?.metadata?.caseId;
      console.log('Checkout session completed for caseId:', caseId, 'sessionId:', session?.id);

      if (!caseId) {
        console.warn('No caseId on Checkout Session metadata; skipping DynamoDB update.');
      } else {
        await markCaseStatus(caseId, 'PAID');
      }
    } else {
      console.log('Unhandled Stripe event type, acknowledging without changes.');
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ received: true }),
    };
  } catch (err: any) {
    console.error('Webhook Error', err?.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        message: 'Webhook Error',
      }),
    };
  }
};
