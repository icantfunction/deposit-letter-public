import type { StateCode } from './stateRules';

export type ScenarioType = 'FULL_REFUND' | 'PARTIAL_REFUND' | 'NO_REFUND' | 'LATE_LETTER';

export type DeductionCategory = 'DAMAGE' | 'CLEANING' | 'UNPAID_RENT' | 'OTHER';

export interface DeductionItem {
  id: string;
  description: string;
  amount: number;
  category: DeductionCategory;
}

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface RiskFlag {
  code: string;
  message: string;
  severity: RiskLevel;
}

export interface RiskAnalysis {
  level: RiskLevel;
  summary: string;
  flags: RiskFlag[];
}

export type EvidenceType = 'PHOTO' | 'VIDEO' | 'RECEIPT' | 'OTHER';

export interface EvidenceItem {
  id: string;
  // Optional when creating a case (frontend), present when stored in DB
  caseId?: string;
  deductionId: string | null;
  label: string;
  type: EvidenceType;
  fileName: string;
  fileSize: number;
  s3Key: string;
  uploadedAt: string; // ISO timestamp
}

export type PaymentStatus = 'UNPAID' | 'PENDING' | 'PAID';

export interface CaseRecord {
  caseId: string;
  tenantName: string;
  propertyAddress: string;
  stateCode: StateCode;
  scenario: ScenarioType;
  moveOutDate: string;
  letterSendDate: string;
  depositAmount: number;
  deductions: DeductionItem[];
  risk: RiskAnalysis | null;
  evidenceIndex: EvidenceItem[];
  paymentStatus?: PaymentStatus;
  stripeSessionId?: string;
}
