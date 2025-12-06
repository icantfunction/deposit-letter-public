import type { StateCode } from './stateRules';
import { getStateRule } from './stateRules';
import type { DeductionItem, RiskLevel, RiskFlag, RiskAnalysis } from './types';

export interface AnalyzeRiskInput {
  stateCode: StateCode;
  moveOutDateISO: string;
  letterSendDateISO: string;
  depositAmount: number;
  deductions: DeductionItem[];
}

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function maxLevel(levels: RiskLevel[]): RiskLevel {
  if (levels.includes('HIGH')) return 'HIGH';
  if (levels.includes('MEDIUM')) return 'MEDIUM';
  return 'LOW';
}

export function analyzeRisk(input: AnalyzeRiskInput): RiskAnalysis {
  const { stateCode, moveOutDateISO, letterSendDateISO, depositAmount, deductions } = input;
  const rule = getStateRule(stateCode);

  const moveOut = new Date(moveOutDateISO);
  const letterSent = new Date(letterSendDateISO);

  const timingDays = daysBetween(moveOut, letterSent);
  const totalDeductions = deductions.reduce(
    (sum, d) => sum + (Number.isFinite(d.amount) ? d.amount : 0),
    0
  );

  const flags: RiskFlag[] = [];

  // Timing risk
  if (Number.isFinite(timingDays)) {
    if (timingDays > rule.deadlineDays) {
      flags.push({
        code: 'LATE_LETTER',
        severity: 'HIGH',
        message: `Letter appears ${timingDays - rule.deadlineDays} days past the ${rule.deadlineDays}-day deadline.`,
      });
    } else if (timingDays > rule.deadlineDays - 3) {
      flags.push({
        code: 'CLOSE_TO_DEADLINE',
        severity: 'MEDIUM',
        message: `Letter was sent ${timingDays} days after move-out, very close to the ${rule.deadlineDays}-day deadline.`,
      });
    } else {
      flags.push({
        code: 'TIMELY',
        severity: 'LOW',
        message: `Letter timing appears within the ${rule.deadlineDays}-day statutory window.`,
      });
    }
  }

  // Math / deduction aggressiveness
  if (totalDeductions > depositAmount * 1.1) {
    flags.push({
      code: 'OVER_DEPOSIT',
      severity: 'HIGH',
      message: 'Total deductions exceed the deposit amount by more than 10%.',
    });
  } else if (totalDeductions > depositAmount * 0.75) {
    flags.push({
      code: 'AGGRESSIVE_DEDUCTIONS',
      severity: 'MEDIUM',
      message: 'Deductions consume more than 75% of the deposit; courts may scrutinize itemization and evidence.',
    });
  } else {
    flags.push({
      code: 'MODEST_DEDUCTIONS',
      severity: 'LOW',
      message: 'Total deductions use a modest portion of the deposit.',
    });
  }

  // Wear-and-tear heuristic: many small items are riskier
  const smallItems = deductions.filter((d) => d.amount > 0 && d.amount <= 50).length;
  if (smallItems >= 5) {
    flags.push({
      code: 'MANY_SMALL_ITEMS',
      severity: 'MEDIUM',
      message:
        'Multiple small charges may look like normal wear-and-tear instead of true damage; ensure photos and receipts are strong.',
    });
  }

  const overallLevel = maxLevel(flags.map((f) => f.severity));

  let summary: string;
  switch (overallLevel) {
    case 'HIGH':
      summary = 'High dispute risk based on timing and deduction profile.';
      break;
    case 'MEDIUM':
      summary = 'Moderate dispute risk; make sure evidence and documentation are tight.';
      break;
    default:
      summary = 'Low apparent dispute risk given current dates and charges.';
  }

  return {
    level: overallLevel,
    summary,
    flags,
  };
}
