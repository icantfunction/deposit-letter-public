import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const TABLE_NAME = process.env.CASE_TABLE_NAME!;
const BUCKET_NAME = process.env.EVIDENCE_BUCKET_NAME!;
const ALLOWED_ORIGIN = process.env.FRONTEND_URL || '*';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
};

function safeParse<T = any>(raw?: string): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const caseId = event.pathParameters?.caseId;
    const tokenHeader =
      event.headers?.['x-case-token'] ||
      event.headers?.['X-Case-Token'] ||
      event.headers?.['x-api-token'];

    if (!caseId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'Missing caseId in path' }),
      };
    }

    // 1) Load case from DynamoDB
    const getRes = await dynamo.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { caseId },
      })
    );

    const item = getRes.Item;
    if (!item) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ message: 'Case not found' }),
      };
    }

    const paymentStatus = (item as any).paymentStatus as string | undefined;
    if (paymentStatus !== 'PAID') {
      return {
        statusCode: 402,
        headers,
        body: JSON.stringify({ message: 'Payment required before generating packet' }),
      };
    }
    const caseSecret = (item as any).caseSecret as string | undefined;
    if (!caseSecret || tokenHeader !== caseSecret) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ message: 'Unauthorized' }),
      };
    }

    const tenantName = (item as any).tenantName ?? 'Tenant';
    const propertyAddress = (item as any).propertyAddress ?? '';
    const stateCode = (item as any).stateCode ?? '';
    const scenario = (item as any).scenario ?? '';
    const depositAmountRaw = (item as any).depositAmount;
    const depositAmount =
      typeof depositAmountRaw === 'number'
        ? depositAmountRaw
        : depositAmountRaw !== undefined
        ? Number(depositAmountRaw)
        : undefined;

    const deductions = Array.isArray((item as any).deductions)
      ? (item as any).deductions
      : safeParse<any[]>((item as any).deductions) ?? [];
    const risk =
      typeof (item as any).risk === 'object' && (item as any).risk !== null
        ? (item as any).risk
        : safeParse<any>((item as any).risk) ?? null;
    const evidenceIndex = Array.isArray((item as any).evidenceIndex)
      ? (item as any).evidenceIndex
      : safeParse<any[]>((item as any).evidenceIndex) ?? [];
    const evidenceByDeduction: Record<string, any[]> = {};
    evidenceIndex.forEach((ev) => {
      if (ev?.deductionId) {
        evidenceByDeduction[ev.deductionId] = evidenceByDeduction[ev.deductionId] || [];
        evidenceByDeduction[ev.deductionId].push(ev);
      }
    });

    // 2) Build PDF using pdf-lib
    const pdfDoc = await PDFDocument.create();
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pageMargin = 50;

    const newPage = () => {
      const page = pdfDoc.addPage();
      const { width, height } = page.getSize();
      return { page, width, height, y: height - pageMargin };
    };

    let { page, width, height, y } = newPage();

    const line = (text: string, options?: { bold?: boolean; size?: number }) => {
      const size = options?.size ?? 11;
      const font = options?.bold ? fontBold : fontRegular;
      const minY = 60;

      if (y < minY) {
        const p = newPage();
        page = p.page;
        width = p.width;
        height = p.height;
        y = p.y;
      }

      page.drawText(text, {
        x: pageMargin,
        y,
        size,
        font,
      });
      y -= size + 4;
    };

    const spacer = (amount = 8) => {
      y -= amount;
    };

    // --- Header ---
    line('Security Deposit Itemization & Defense Packet', {
      bold: true,
      size: 18,
    });
    spacer(12);

    // Case summary
    line('1. Case summary', { bold: true, size: 14 });
    spacer(4);

    line(`Tenant: ${tenantName}`);
    if (propertyAddress) line(`Property: ${propertyAddress}`);
    if (stateCode) line(`Jurisdiction: ${stateCode}`);
    if (scenario) line(`Scenario: ${scenario}`);
    if (typeof depositAmount === 'number') {
      line(`Deposit amount: $${depositAmount.toFixed(2)}`);
    }
    spacer(10);

    // --- Deductions ---
    line('2. Deductions', { bold: true, size: 14 });
    spacer(4);

    if (deductions.length === 0) {
      line('No deductions recorded for this case.');
    } else {
      deductions.forEach((d: any, idx: number) => {
        const desc = d.description || 'Untitled charge';
        const amount = Number(d.amount ?? 0);
        const category = d.category ?? 'OTHER';

        line(
          `${idx + 1}. ${desc} — $${amount.toFixed(2)} (${category})`
        );
      });
    }
    spacer(10);

    // --- Risk / timing analysis (optional) ---
    if (risk) {
      line('3. Timing & risk analysis (internal)', {
        bold: true,
        size: 14,
      });
      spacer(4);

      if (risk.level) {
        line(`Overall risk level: ${risk.level}`);
        spacer(4);
      }

      if (Array.isArray(risk.flags) && risk.flags.length > 0) {
        risk.flags.forEach((f: any) => {
          line(`• ${f.message}`);
        });
      } else {
        line('No specific flags recorded for this case.');
      }
      spacer(10);
    }

    // --- Evidence index ---
    if (evidenceIndex.length > 0) {
      line('4. Evidence index', { bold: true, size: 14 });
      spacer(4);

      line(
        'Each file is tagged by type and mapped, when possible, to a specific deduction.',
        { size: 10 }
      );
      spacer(6);

      evidenceIndex.forEach((ev: any, idx: number) => {
        const type = ev.type ?? 'OTHER';
        const label = ev.label ?? ev.fileName ?? '(unnamed file)';
        const s3Key = ev.s3Key ?? '(key not recorded)';

        const linked = deductions.find(
          (d: any) => d.id && ev.deductionId && d.id === ev.deductionId
        );

        let header = `${idx + 1}. [${type}] ${label}`;
        line(header);

        if (linked) {
          const linkedDesc = linked.description || 'Untitled charge';
          const linkedAmount = Number(linked.amount ?? 0);
          line(
            `   Linked deduction: ${linkedDesc} — $${linkedAmount.toFixed(
              2
            )}`,
            { size: 10 }
          );
        } else {
          line('   Linked deduction: General / unassigned', { size: 10 });
        }

        line(`   Storage key: ${s3Key}`, { size: 9 });
        spacer(4);
      });
    } else {
      line('4. Evidence index', { bold: true, size: 14 });
      spacer(4);
      line('No evidence files recorded for this case yet.');
    }

    // --- Evidence mapped to deductions (judge-friendly view) ---
    if (deductions.length > 0) {
      spacer(6);
      line('4a. Evidence mapped to deductions', { bold: true, size: 14 });
      spacer(4);
      deductions.forEach((d: any, idx: number) => {
        const desc = d.description || 'Untitled charge';
        const linkedEvidence = d.id ? evidenceByDeduction[d.id] || [] : [];
        line(`${idx + 1}. ${desc}`, { size: 11, bold: true });
        if (linkedEvidence.length === 0) {
          line('   - No linked evidence', { size: 10 });
        } else {
          linkedEvidence.forEach((ev: any) => {
            const label = ev.label ?? ev.fileName ?? '(unnamed file)';
            const type = ev.type ?? 'OTHER';
            const fileName = ev.fileName ?? '(file)';
            line(`   - [${type}] ${label} (${fileName})`, { size: 10 });
          });
        }
        spacer(2);
      });
    }

    const pdfBytes = await pdfDoc.save();

    // 3) Put into S3
    const letterKey = `packets/${caseId}/letter.pdf`;

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: letterKey,
        Body: Buffer.from(pdfBytes),
        ContentType: 'application/pdf',
      })
    );

    // 4) Respond
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: 'READY',
        objects: {
          letter: letterKey,
        },
      }),
    };
  } catch (err: any) {
    console.error('Error generating packet', err?.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        message: 'Internal server error (generate-packet)',
      }),
    };
  }
};
