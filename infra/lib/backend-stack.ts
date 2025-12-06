import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as eventbridge from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as path from 'path';

export class BackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const caseTable = new dynamodb.Table(this, 'CaseFilesTable', {
      tableName: 'CaseFiles',
      partitionKey: { name: 'caseId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const evidenceBucket = new s3.Bucket(this, 'EvidenceBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const frontendUrlParam = new cdk.CfnParameter(this, 'FrontendUrl', {
      type: 'String',
      default: 'https://main.d1k03hztipi3ci.amplifyapp.com',
      description: 'Public frontend base URL (e.g., https://app.example.com)',
    });

    const stripeEventBusNameParam = new cdk.CfnParameter(this, 'StripeEventBusName', {
      type: 'String',
      description:
        'Name of the Stripe partner EventBridge bus (e.g., aws.partner/stripe.com/<account>/<connection-id>/<region>)',
      default:
        'aws.partner/stripe.com/279630655712/ed_61TjXgdoOnI7kiKro16TNBHO3tSQ7lRxR7je3TGO0LY0',
    });

    const stripeEventSourceParam = new cdk.CfnParameter(this, 'StripeEventSource', {
      type: 'String',
      description: 'EventBridge source string for Stripe partner events (e.g., aws.partner/stripe.com/<account>)',
      default: 'aws.partner/stripe.com/ed_61TjXgdoOnI7kiKro16TNBHO3tSQ7lRxR7je3TGO0LY0',
    });

    const commonProps: Omit<lambdaNodejs.NodejsFunctionProps, 'entry'> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      bundling: { externalModules: ['aws-sdk'] },
      environment: {
        CASE_TABLE_NAME: caseTable.tableName,
        EVIDENCE_BUCKET_NAME: evidenceBucket.bucketName,
        FRONTEND_URL: frontendUrlParam.valueAsString,
        STRIPE_SECRET_NAME: 'stripe/secret-key',
      },
    };

    const createCaseFn = new lambdaNodejs.NodejsFunction(this, 'CreateCaseFunction', {
      entry: path.join(__dirname, '../lambda/create-case.ts'),
      ...commonProps,
    });

    const getCaseFn = new lambdaNodejs.NodejsFunction(this, 'GetCaseFunction', {
      entry: path.join(__dirname, '../lambda/get-case.ts'),
      ...commonProps,
    });

    const listCasesFn = new lambdaNodejs.NodejsFunction(this, 'ListCasesFunction', {
      entry: path.join(__dirname, '../lambda/list-cases.ts'),
      ...commonProps,
    });

    const generatePacketFn = new lambdaNodejs.NodejsFunction(this, 'GeneratePacketFunction', {
      entry: path.join(__dirname, '../lambda/generate-packet.ts'),
      ...commonProps,
      timeout: cdk.Duration.seconds(30),
    });

    const getDownloadUrlFn = new lambdaNodejs.NodejsFunction(this, 'GetDownloadUrlFunction', {
      entry: path.join(__dirname, '../lambda/get-download-url.ts'),
      ...commonProps,
    });

    const createPaymentIntentFn = new lambdaNodejs.NodejsFunction(
      this,
      'CreatePaymentIntentFunction',
      {
        entry: path.join(__dirname, '../lambda/create-payment-intent.ts'),
        ...commonProps,
      }
    );

    const stripeEventBridgeFn = new lambdaNodejs.NodejsFunction(
      this,
      'StripeEventBridgeFunction',
      {
        entry: path.join(__dirname, '../lambda/stripe-eventbridge.ts'),
        ...commonProps,
      }
    );

    // NEW: create upload URL function
    const createUploadUrlFn = new lambdaNodejs.NodejsFunction(
      this,
      'CreateUploadUrlFunction',
      {
        entry: path.join(__dirname, '../lambda/create-upload-url.ts'),
        ...commonProps,
      }
    );

    // ---- Permissions ----
    caseTable.grantReadWriteData(createCaseFn);
    caseTable.grantReadData(getCaseFn);
    caseTable.grantReadData(listCasesFn);
    caseTable.grantReadWriteData(generatePacketFn);
    caseTable.grantReadWriteData(createPaymentIntentFn);
    caseTable.grantReadWriteData(stripeEventBridgeFn);

    evidenceBucket.grantReadWrite(generatePacketFn);
    evidenceBucket.grantReadWrite(createCaseFn);
    evidenceBucket.grantRead(getDownloadUrlFn);
    evidenceBucket.grantWrite(createUploadUrlFn);

    const secretPolicy = new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [
        `arn:aws:secretsmanager:${this.region}:${this.account}:secret:stripe/secret-key-*`,
      ],
    });

    createPaymentIntentFn.addToRolePolicy(secretPolicy);

    // EventBridge rule for Stripe partner events (only if parameters provided)
    if (stripeEventBusNameParam.valueAsString !== '') {
      const stripeEventBus = eventbridge.EventBus.fromEventBusName(
        this,
        'StripePartnerBus',
        stripeEventBusNameParam.valueAsString
      );

      const stripeRule = new eventbridge.Rule(this, 'StripePartnerRule', {
        eventBus: stripeEventBus,
        eventPattern: {
          source: stripeEventSourceParam.valueAsString
            ? [stripeEventSourceParam.valueAsString]
            : undefined,
          detailType: [
            'payment_intent.succeeded',
            'payment_intent.payment_failed',
            'checkout.session.completed',
          ],
        },
      });

      stripeRule.addTarget(new targets.LambdaFunction(stripeEventBridgeFn));
    }

    // ---- API Gateway ----
    const corsAllowHeaders = Array.from(
      new Set([
        ...apigateway.Cors.DEFAULT_HEADERS,
        'Content-Type',
        'Authorization',
        'x-api-token',
        'x-case-token',
        'X-Case-Token',
      ])
    );

    const api = new apigateway.RestApi(this, 'CaseApi', {
      defaultCorsPreflightOptions: {
        allowOrigins: [frontendUrlParam.valueAsString],
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: corsAllowHeaders,
      },
    });

    const cases = api.root.addResource('cases');
    cases.addMethod('POST', new apigateway.LambdaIntegration(createCaseFn));
    cases.addMethod('GET', new apigateway.LambdaIntegration(listCasesFn));

    const singleCase = cases.addResource('{caseId}');
    singleCase.addMethod('GET', new apigateway.LambdaIntegration(getCaseFn));
    singleCase
      .addResource('generate-packet')
      .addMethod('POST', new apigateway.LambdaIntegration(generatePacketFn));

    api.root
      .addResource('download')
      .addMethod('POST', new apigateway.LambdaIntegration(getDownloadUrlFn));

    const billing = api.root.addResource('billing');
    billing
      .addResource('payment-intent')
      .addMethod('POST', new apigateway.LambdaIntegration(createPaymentIntentFn));

    const webhooks = api.root.addResource('webhooks');
    // Stripe webhook route removed in favor of EventBridge partner events.

    const evidence = api.root.addResource('evidence');
    evidence
      .addResource('upload-url')
      .addMethod('POST', new apigateway.LambdaIntegration(createUploadUrlFn));

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url });
    new cdk.CfnOutput(this, 'FrontendUrlOutput', { value: frontendUrlParam.valueAsString });
    new cdk.CfnOutput(this, 'StripeEventBusNameOutput', { value: stripeEventBusNameParam.valueAsString });
    new cdk.CfnOutput(this, 'StripeEventSourceOutput', { value: stripeEventSourceParam.valueAsString });
    new cdk.CfnOutput(this, 'CaseTableName', { value: caseTable.tableName });
    new cdk.CfnOutput(this, 'EvidenceBucketName', { value: evidenceBucket.bucketName });
  }
}
