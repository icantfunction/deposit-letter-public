// Handler for Stripe events delivered via EventBridge partner source (no signature header).
import { APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

const TABLE_NAME = process.env.CASE_TABLE_NAME!;
const dynamo = new DynamoDBClient({});
const ALLOWED_ORIGIN = process.env.FRONTEND_URL || '*';

type EventBridgeStripeEvent = {
  id?: string;
  detail?: {
    type?: string;
    data?: { object?: any };
  };
};

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
};

export const handler = async (event: EventBridgeStripeEvent): Promise<APIGatewayProxyResult> => {
  try {
    const type = event.detail?.type;
    const dataObject = event.detail?.data?.object;

    console.log('EventBridge Stripe event received:', {
      id: event.id,
      type,
      hasData: Boolean(dataObject),
    });

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
      const pi = dataObject;
      const caseId: string | undefined = pi?.metadata?.caseId;
      const paymentIntentId: string | undefined = pi?.id;

      console.log('PaymentIntent payload (EventBridge):', {
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
      const session = dataObject;
      const caseId: string | undefined = session?.metadata?.caseId;
      console.log('Checkout session completed (EventBridge) for caseId:', caseId, 'sessionId:', session?.id);

      if (!caseId) {
        console.warn('No caseId on Checkout Session metadata; skipping DynamoDB update.');
      } else {
        await markCaseStatus(caseId, 'PAID');
      }
    } else {
      console.log('Unhandled Stripe event type from EventBridge, acknowledging without changes.');
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ received: true }),
    };
  } catch (err: any) {
    console.error('EventBridge Webhook Error', err?.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        message: 'Webhook Error',
      }),
    };
  }
};
