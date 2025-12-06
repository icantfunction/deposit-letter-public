// src/lib/stateRules.ts
export type StateCode = 'CA' | 'TX' | 'FL' | 'NY' | 'IL';

export interface StateRule {
  code: StateCode;
  name: string;
  deadlineDays: number;
  description: string;
  statuteCitation: string;
  interestRequired: boolean;
  computeDeadline: (moveOutDate: Date) => Date;
  requiredPhrases: string[];
}

const addDays = (d: Date, days: number) => {
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
};

export const stateRules: Record<StateCode, StateRule> = {
  CA: {
    code: 'CA',
    name: 'California',
    deadlineDays: 21,
    description:
      'Landlord must return the deposit or send an itemized statement within 21 calendar days after the tenant vacates.',
    statuteCitation: 'Cal. Civ. Code Sec. 1950.5',
    interestRequired: false,
    computeDeadline: (moveOutDate) => addDays(moveOutDate, 21),
    requiredPhrases: ['itemized statement of deductions'],
  },
  TX: {
    code: 'TX',
    name: 'Texas',
    deadlineDays: 30,
    description:
      'Landlord must refund the deposit and send a written description and itemized list of all deductions within 30 days after surrender.',
    statuteCitation: 'Tex. Prop. Code Sec. 92.104',
    interestRequired: false,
    computeDeadline: (moveOutDate) => addDays(moveOutDate, 30),
    requiredPhrases: ['written description and itemized list of all deductions'],
  },
  FL: {
    code: 'FL',
    name: 'Florida',
    deadlineDays: 30,
    description:
      'Landlord must send written notice of intent to impose a claim on the deposit within 30 days after the tenant vacates.',
    statuteCitation: 'Fla. Stat. Sec. 83.49(3)',
    interestRequired: true,
    computeDeadline: (moveOutDate) => addDays(moveOutDate, 30),
    requiredPhrases: [
      'This notice is sent to you as required by section 83.49(3), Florida Statutes.',
    ],
  },
  NY: {
    code: 'NY',
    name: 'New York',
    deadlineDays: 14,
    description:
      'Landlord must provide an itemized statement and return any remaining deposit within 14 days after the tenant vacates.',
    statuteCitation: 'N.Y. Gen. Oblig. Law Sec. 7-108',
    interestRequired: false,
    computeDeadline: (moveOutDate) => addDays(moveOutDate, 14),
    requiredPhrases: ['itemized statement'],
  },
  IL: {
    code: 'IL',
    name: 'Illinois',
    deadlineDays: 30,
    description:
      'For buildings of five or more units, landlord must provide an itemized statement of damages with receipts or estimates within 30 days.',
    statuteCitation: '765 ILCS 710/1 et seq.',
    interestRequired: true,
    computeDeadline: (moveOutDate) => addDays(moveOutDate, 30),
    requiredPhrases: ['itemized statement of damages'],
  },
};

export function getStateRule(code: StateCode): StateRule {
  return stateRules[code];
}

export const STATES: { code: StateCode; label: string }[] = [
  { code: 'CA', label: 'California' },
  { code: 'TX', label: 'Texas' },
  { code: 'FL', label: 'Florida' },
  { code: 'NY', label: 'New York' },
  { code: 'IL', label: 'Illinois' },
];
