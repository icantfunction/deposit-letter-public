// web/src/lib/api.ts
import {
  DeductionItem,
  ScenarioType,
  RiskAnalysis,
  EvidenceItem,
  CaseRecord,
} from './types';
import { StateCode } from './stateRules';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;

if (!API_BASE) {
  // eslint-disable-next-line no-console
  console.warn('NEXT_PUBLIC_API_BASE_URL is not set. API calls will fail.');
}

export interface CreateCasePayload {
  tenantName: string;
  propertyAddress: string;
  stateCode: StateCode;
  scenario: ScenarioType;
  moveOutDate: string; // YYYY-MM-DD
  letterSendDate: string; // YYYY-MM-DD
  depositAmount: number;
  deductions: DeductionItem[];
  risk: RiskAnalysis | null;
  evidenceIndex: EvidenceItem[];
}

export interface CreateCaseResponse {
  caseId: string;
  caseSecret: string;
}

export async function getCase(caseId: string, caseToken: string): Promise<CaseRecord> {
  if (!API_BASE) {
    throw new Error(
      'API base URL not configured (NEXT_PUBLIC_API_BASE_URL missing)'
    );
  }

  const res = await fetch(`${API_BASE}/cases/${caseId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-case-token': caseToken,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Failed to fetch case (status ${res.status}): ${
        text || res.statusText
      }`
    );
  }

  return res.json();
}

export async function createCase(
  payload: CreateCasePayload
): Promise<CreateCaseResponse> {
  if (!API_BASE) {
    throw new Error(
      'API base URL not configured (NEXT_PUBLIC_API_BASE_URL missing)'
    );
  }

  const res = await fetch(`${API_BASE}/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Failed to create case (status ${res.status}): ${
        text || res.statusText
      }`
    );
  }

  return res.json();
}

// --- Packet generation ---

export interface GeneratePacketResponse {
  status: string; // e.g. "READY"
  objects: {
    letter: string; // e.g. "packets/<caseId>/letter.pdf"
  };
}

export async function generatePacket(
  caseId: string,
  caseToken: string
): Promise<GeneratePacketResponse> {
  if (!API_BASE) {
    throw new Error(
      'API base URL not configured (NEXT_PUBLIC_API_BASE_URL missing)'
    );
  }

  const res = await fetch(`${API_BASE}/cases/${caseId}/generate-packet`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-case-token': caseToken,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Failed to generate packet (status ${res.status}): ${
        text || res.statusText
      }`
    );
  }

  return res.json();
}

// --- Download URL (presigned) ---

export interface DownloadUrlResponse {
  url: string;
}

export async function getDownloadUrl(
  key: string,
  caseToken: string
): Promise<DownloadUrlResponse> {
  if (!API_BASE) {
    throw new Error(
      'API base URL not configured (NEXT_PUBLIC_API_BASE_URL missing)'
    );
  }

  const res = await fetch(`${API_BASE}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, caseToken }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Failed to get download URL (status ${res.status}): ${
        text || res.statusText
      }`
    );
  }

  return res.json();
}

// --- Stripe PaymentIntent ---

export interface PaymentIntentResponse {
  clientSecret: string;
}

export async function createPaymentIntent(
  caseId: string,
  caseToken: string
): Promise<PaymentIntentResponse> {
  if (!API_BASE) {
    throw new Error(
      'API base URL not configured (NEXT_PUBLIC_API_BASE_URL missing)'
    );
  }

  const res = await fetch(`${API_BASE}/billing/payment-intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caseId, caseToken }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Failed to create payment intent (status ${res.status}): ${
        text || res.statusText
      }`
    );
  }

  return res.json();
}

// --- Upload URL for evidence ---

export interface CreateUploadUrlInput {
  caseId: string;
  caseToken: string;
  fileName: string;
  contentType: string;
  fileSize: number;
}

export interface CreateUploadUrlResponse {
  uploadUrl: string;
  key: string;
}

export async function createUploadUrl(
  input: CreateUploadUrlInput
): Promise<CreateUploadUrlResponse> {
  if (!API_BASE) {
    throw new Error(
      'API base URL not configured (NEXT_PUBLIC_API_BASE_URL missing)'
    );
  }

  const res = await fetch(`${API_BASE}/evidence/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Failed to create upload URL (status ${res.status}): ${
        text || res.statusText
      }`
    );
  }

  return res.json();
}
