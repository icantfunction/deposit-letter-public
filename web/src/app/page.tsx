'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { getStateRule, STATES, StateCode } from '@/lib/stateRules';
import {
  DeductionItem,
  ScenarioType,
  DeductionCategory,
  PaymentStatus,
} from '@/lib/types';
import { analyzeRisk } from '@/lib/riskEngine';
import {
  createCase,
  generatePacket,
  getDownloadUrl,
  createPaymentIntent,
  createUploadUrl,
  getCase,
} from '@/lib/api';

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY as string
);

const SCENARIOS: { code: ScenarioType; label: string }[] = [
  { code: 'FULL_REFUND', label: 'Full refund' },
  { code: 'PARTIAL_REFUND', label: 'Partial refund' },
  { code: 'NO_REFUND', label: 'No refund' },
  { code: 'LATE_LETTER', label: 'Late letter (past deadline)' },
];

const CATEGORY_OPTIONS: { value: DeductionCategory; label: string }[] = [
  { value: 'DAMAGE', label: 'Damage' },
  { value: 'CLEANING', label: 'Cleaning' },
  { value: 'UNPAID_RENT', label: 'Unpaid rent' },
  { value: 'OTHER', label: 'Other' },
];

type EvidenceUploadStatus = 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'ERROR';

type EvidenceKind = 'PHOTO' | 'RECEIPT' | 'OTHER';

interface EvidenceFormItem {
  id: string;
  deductionId: string | null;
  label: string;
  type: EvidenceKind;
  file: File | null;
  uploadStatus: EvidenceUploadStatus;
  error?: string;
  s3Key?: string;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function createEmptyDeduction(): DeductionItem {
  return {
    id: newId(),
    description: '',
    amount: 0,
    category: 'DAMAGE',
  };
}

function createEmptyEvidence(): EvidenceFormItem {
  return {
    id: newId(),
    deductionId: null,
    label: '',
    type: 'PHOTO',
    file: null,
    uploadStatus: 'PENDING',
  };
}

interface PaymentFormProps {
  onPaid: () => Promise<void> | void;
}

function PaymentForm({ onPaid }: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsProcessing(true);
    setErrorMessage(null);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // No redirect; stay embedded in app
        return_url: window.location.href,
      },
      redirect: 'if_required',
    });

    if (error) {
      setErrorMessage(error.message || 'Payment failed. Check card details and try again.');
    } else if (paymentIntent && paymentIntent.status === 'succeeded') {
      await onPaid();
    } else {
      setErrorMessage(
        'Payment did not succeed. Please confirm the charge in your banking app or try again.'
      );
    }

    setIsProcessing(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <PaymentElement />
      {errorMessage && (
        <p className="text-xs text-red-400 mt-1">{errorMessage}</p>
      )}
      <button
        type="submit"
        disabled={!stripe || isProcessing}
        className="mt-2 inline-flex items-center justify-center rounded-md bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-300 transition w-full disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isProcessing ? 'Processing payment...' : 'Pay $2 & generate packet'}
      </button>
    </form>
  );
}

export default function HomePage() {
  const [stateCode, setStateCode] = useState<StateCode>('CA');
  const [moveOutDate, setMoveOutDate] = useState('');
  const [letterSendDate, setLetterSendDate] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [scenario, setScenario] = useState<ScenarioType>('PARTIAL_REFUND');
  const [deductions, setDeductions] = useState<DeductionItem[]>([
    createEmptyDeduction(),
  ]);

  const [evidenceItems, setEvidenceItems] = useState<EvidenceFormItem[]>([]);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedCaseId, setSavedCaseId] = useState<string | null>(null);
  const [savedCaseToken, setSavedCaseToken] = useState<string | null>(null);
  const [caseSavedMessage, setCaseSavedMessage] = useState<string | null>(null);

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('UNPAID');
  const [hasStartedCheckout, setHasStartedCheckout] = useState(false);
  const [isLoadingCaseStatus, setIsLoadingCaseStatus] = useState(false);

  const [packetStatus, setPacketStatus] = useState<string | null>(null);
  const [packetLetterKey, setPacketLetterKey] = useState<string | null>(null);
  const [isGeneratingPacket, setIsGeneratingPacket] = useState(false);

  const rule = getStateRule(stateCode);

  const deadline = useMemo(() => {
    if (!moveOutDate) return null;
    const d = rule.computeDeadline(new Date(`${moveOutDate}T00:00:00`));
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }, [rule, moveOutDate]);

  const depositNumber = depositAmount ? Number(depositAmount) : null;

  const subtotalDeductions = useMemo(
    () =>
      deductions.reduce(
        (sum, d) => sum + (Number.isFinite(d.amount) ? d.amount : 0),
        0
      ),
    [deductions]
  );

  const risk = useMemo(() => {
    if (!moveOutDate || !letterSendDate || !depositNumber) {
      return null;
    }
    return analyzeRisk({
      stateCode,
      moveOutDateISO: `${moveOutDate}T00:00:00`,
      letterSendDateISO: `${letterSendDate}T00:00:00`,
      depositAmount: depositNumber,
      deductions,
    });
  }, [stateCode, moveOutDate, letterSendDate, depositNumber, deductions]);

  const remainingToRefund =
    depositNumber !== null
      ? Math.max(depositNumber - subtotalDeductions, 0)
      : null;

  async function refreshCaseStatus(caseId: string, caseToken: string | null): Promise<PaymentStatus> {
    if (!caseToken) {
      setSaveError('Missing case token. Please save the case again.');
      return paymentStatus;
    }
    try {
      setIsLoadingCaseStatus(true);
      const caseFile = await getCase(caseId, caseToken);
      const status = caseFile.paymentStatus ?? 'UNPAID';
      setPaymentStatus(status);
      return status;
    } catch (err) {
      console.error('Failed to refresh case status', err);
      return paymentStatus;
    } finally {
      setIsLoadingCaseStatus(false);
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedCaseId = window.localStorage.getItem('deposit:lastCaseId');
    if (storedCaseId) {
      setSavedCaseId(storedCaseId);
      const storedToken = window.localStorage.getItem(
        `deposit:caseToken:${storedCaseId}`
      );
      if (storedToken) {
        setSavedCaseToken(storedToken);
      }
      const storedStatus = window.localStorage.getItem(
        `deposit:paymentStatus:${storedCaseId}`
      ) as PaymentStatus | null;
      if (storedStatus === 'PAID' || storedStatus === 'PENDING') {
        setPaymentStatus(storedStatus);
        if (storedStatus === 'PAID') {
          setHasStartedCheckout(true);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!savedCaseId) return;
    void refreshCaseStatus(savedCaseId, savedCaseToken);
  }, [savedCaseId, savedCaseToken]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (savedCaseId) {
      window.localStorage.setItem('deposit:lastCaseId', savedCaseId);
      if (savedCaseToken) {
        window.localStorage.setItem(
          `deposit:caseToken:${savedCaseId}`,
          savedCaseToken
        );
      }
      window.localStorage.setItem(
        `deposit:paymentStatus:${savedCaseId}`,
        paymentStatus
      );
    }
  }, [paymentStatus, savedCaseId]);

  useEffect(() => {
    if (paymentStatus === 'PAID') {
      setHasStartedCheckout(true);
    }
  }, [paymentStatus]);

  const requiredFieldsComplete = useMemo(() => {
    return Boolean(
      tenantName &&
        propertyAddress &&
        moveOutDate &&
        letterSendDate &&
        depositNumber !== null &&
        depositNumber > 0
    );
  }, [tenantName, propertyAddress, moveOutDate, letterSendDate, depositNumber]);

  const evidenceCountByDeduction = useMemo(() => {
    const counts: Record<string, number> = {};
    evidenceItems.forEach((e) => {
      if (e.deductionId) {
        counts[e.deductionId] = (counts[e.deductionId] || 0) + 1;
      }
    });
    return counts;
  }, [evidenceItems]);

  function updateDeduction(id: string, patch: Partial<DeductionItem>) {
    setDeductions((prev) =>
      prev.map((d) => (d.id === id ? { ...d, ...patch } : d))
    );
  }

  function addDeductionRow() {
    setDeductions((prev) => [...prev, createEmptyDeduction()]);
  }

  function removeDeductionRow(id: string) {
    setDeductions((prev) =>
      prev.length <= 1 ? prev : prev.filter((d) => d.id !== id)
    );
  }

  function addEvidenceRow() {
    setEvidenceItems((prev) => [...prev, createEmptyEvidence()]);
  }

  function updateEvidence(
    id: string,
    patch: Partial<Omit<EvidenceFormItem, 'id'>>
  ) {
    setEvidenceItems((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e))
    );
  }

  function removeEvidenceRow(id: string) {
    setEvidenceItems((prev) => prev.filter((e) => e.id !== id));
  }

  async function handleUploadEvidence(item: EvidenceFormItem) {
    try {
      if (!savedCaseId) {
        setSaveError('Save the case before uploading evidence.');
        return;
      }
      if (!savedCaseToken) {
        setSaveError('Missing case token. Please save the case again.');
        return;
      }
      if (!item.file) {
        updateEvidence(item.id, {
          uploadStatus: 'ERROR',
          error: 'Choose a file first.',
        });
        return;
      }

      updateEvidence(item.id, { uploadStatus: 'UPLOADING', error: undefined });

      const { uploadUrl, key } = await createUploadUrl({
        caseId: savedCaseId,
        caseToken: savedCaseToken,
        fileName: item.file.name,
        contentType: item.file.type || 'application/octet-stream',
        fileSize: item.file.size,
      });

      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': item.file.type || 'application/octet-stream',
        },
        body: item.file,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(
          text || `Upload failed with status ${res.status.toString()}`
        );
      }

      updateEvidence(item.id, {
        uploadStatus: 'UPLOADED',
        s3Key: key,
      });
    } catch (err: any) {
      console.error(err);
      updateEvidence(item.id, {
        uploadStatus: 'ERROR',
        error: err?.message || 'Upload failed.',
      });
    }
  }

  const canGeneratePacket =
    requiredFieldsComplete && paymentStatus === 'PAID';
  const showGeneratePacketButton = hasStartedCheckout || paymentStatus === 'PAID';

  async function handleGeneratePacketClick() {
    if (!requiredFieldsComplete) {
      setSaveError('Please fill required fields before generating the packet.');
      return;
    }
    if (paymentStatus !== 'PAID') {
      setSaveError('Complete payment before generating the defense packet.');
      return;
    }

    const saved = savedCaseId && savedCaseToken ? { caseId: savedCaseId, caseSecret: savedCaseToken } : await saveCaseCore();
    if (!saved) return;

    try {
      setIsGeneratingPacket(true);
      const packetRes = await generatePacket(saved.caseId, saved.caseSecret);
      setPacketStatus(packetRes.status);
      const key = packetRes.objects?.letter ?? null;
      setPacketLetterKey(key);

      if (key) {
        const { url } = await getDownloadUrl(key, saved.caseSecret);
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (err: any) {
      console.error(err);
      setSaveError(
        err?.message ||
          'Generating the packet failed. Please try again or contact support.'
      );
    } finally {
      setIsGeneratingPacket(false);
    }
  }

  async function saveCaseCore(): Promise<{ caseId: string; caseSecret: string } | null> {
    try {
      setSaveError(null);
      setCaseSavedMessage(null);
      setPacketStatus(null);
      setPacketLetterKey(null);

      if (!tenantName || !propertyAddress) {
        setSaveError('Please enter tenant name and property address.');
        return null;
      }
      if (!moveOutDate || !letterSendDate) {
        setSaveError('Please enter move-out date and letter send date.');
        return null;
      }
      if (!depositNumber || depositNumber <= 0) {
        setSaveError('Please enter a valid deposit amount.');
        return null;
      }

      const evidenceIndex = evidenceItems
        .filter((e) => e.uploadStatus === 'UPLOADED' && e.s3Key && e.file)
        .map((e) => ({
          id: e.id,
          deductionId: e.deductionId,
          label: e.label || e.file!.name,
          type: e.type,
          fileName: e.file!.name,
          fileSize: e.file!.size,
          s3Key: e.s3Key!,
          uploadedAt: new Date().toISOString(),
        }));

      const payload = {
        tenantName,
        propertyAddress,
        stateCode,
        scenario,
        moveOutDate,
        letterSendDate,
        depositAmount: depositNumber,
        deductions,
        risk,
        evidenceIndex,
      };

      const res = await createCase(payload);
      if (res.caseId !== savedCaseId) {
        setPaymentStatus('UNPAID');
        setHasStartedCheckout(false);
        setClientSecret(null);
      }
      setSavedCaseId(res.caseId);
      setSavedCaseToken(res.caseSecret);
      setCaseSavedMessage('Case saved successfully.');
      return { caseId: res.caseId, caseSecret: res.caseSecret };
    } catch (err: any) {
      console.error(err);
      setSaveError(
        err?.message || 'Something went wrong while saving the case.'
      );
      return null;
    }
  }

  async function handleSaveCaseClick() {
    try {
      setIsSaving(true);
      await saveCaseCore();
    } finally {
      setIsSaving(false);
    }
  }

  async function handleStartCheckout() {
    try {
      setPaymentError(null);
      setIsStartingCheckout(true);

      const saved = await saveCaseCore();
      if (!saved) return;

      const { clientSecret: cs } = await createPaymentIntent(saved.caseId, saved.caseSecret);
      setClientSecret(cs);
      setSavedCaseId(saved.caseId);
      setSavedCaseToken(saved.caseSecret);
      setHasStartedCheckout(true);
    } catch (err: any) {
      console.error(err);
      setPaymentError(
        err?.message || 'Failed to start checkout. Please try again.'
      );
    } finally {
      setIsStartingCheckout(false);
    }
  }

  async function handleAfterPaid() {
    if (savedCaseId && savedCaseToken) {
      const status = await refreshCaseStatus(savedCaseId, savedCaseToken);
      if (status !== 'PAID') {
        setPaymentStatus('PAID');
      }
    } else {
      setPaymentStatus('PAID');
    }
    await handleGeneratePacketClick();
  }

  const riskBadgeColor =
    risk?.level === 'HIGH'
      ? 'bg-red-500 text-white'
      : risk?.level === 'MEDIUM'
      ? 'bg-amber-400 text-slate-950'
      : 'bg-emerald-500 text-slate-950';

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-5xl space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold">
            Security Deposit Defense File Generator
          </h1>
          <p className="text-slate-300 text-sm">
            Capture your move-out details once. We structure your letter to state
            law, highlight timing risk, and prepare a court-ready defense packet.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.2fr,1fr]">
          {/* Left column: inputs */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-4">
            <h2 className="text-lg font-semibold">1. Case details</h2>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-300">
                Tenant name
              </label>
              <input
                className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="Jane Tenant"
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-300">
                Property address
              </label>
              <input
                className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="123 Main St, Unit 4B"
                value={propertyAddress}
                onChange={(e) => setPropertyAddress(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-300">
                  State
                </label>
                <select
                  className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
                  value={stateCode}
                  onChange={(e) => setStateCode(e.target.value as StateCode)}
                >
                  {STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-300">
                  Scenario
                </label>
                <select
                  className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value as ScenarioType)}
                >
                  {SCENARIOS.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-300">
                  Move-out date
                </label>
                <input
                  type="date"
                  className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
                  value={moveOutDate}
                  onChange={(e) => setMoveOutDate(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-300">
                  Letter send date
                </label>
                <input
                  type="date"
                  className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
                  value={letterSendDate}
                  onChange={(e) => setLetterSendDate(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-300">
                  Deposit amount (USD)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-300">
                  Total deductions (auto)
                </label>
                <div className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-sm flex items-center">
                  {subtotalDeductions.toFixed(2)}
                </div>
              </div>
            </div>

            {/* Deductions table */}
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Line-item deductions</h3>
                <button
                  type="button"
                  onClick={addDeductionRow}
                  className="text-xs px-2 py-1 rounded-md border border-amber-400 text-amber-300 hover:bg-amber-400 hover:text-slate-950 transition"
                >
                  + Add line item
                </button>
              </div>

              <div className="space-y-2">
                {deductions.map((d) => (
                  <div
                    key={d.id}
                    className="grid grid-cols-[1.5fr,0.8fr,0.8fr,auto] gap-2 items-center"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-amber-400"
                        placeholder={`Description (e.g. "Hole in bedroom drywall")`}
                        value={d.description}
                        onChange={(e) =>
                          updateDeduction(d.id, { description: e.target.value })
                        }
                      />
                      <span
                        className={`whitespace-nowrap text-[10px] px-2 py-0.5 rounded-full border ${
                          evidenceCountByDeduction[d.id]
                            ? 'border-emerald-400 text-emerald-300 bg-emerald-400/10'
                            : 'border-slate-700 text-slate-400 bg-slate-800'
                        }`}
                      >
                        Evidence {evidenceCountByDeduction[d.id] || 0}
                      </span>
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-amber-400"
                      placeholder="Amount"
                      value={d.amount.toString()}
                      onChange={(e) =>
                        updateDeduction(d.id, {
                          amount: Number(e.target.value || '0'),
                        })
                      }
                    />
                    <select
                      className="rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-amber-400"
                      value={d.category}
                      onChange={(e) =>
                        updateDeduction(d.id, {
                          category: e.target.value as DeductionCategory,
                        })
                      }
                    >
                      {CATEGORY_OPTIONS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeDeductionRow(d.id)}
                      className="text-[10px] px-2 py-1 rounded-md border border-slate-700 text-slate-400 hover:bg-slate-800"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              {remainingToRefund !== null && (
                <p className="text-xs text-slate-300 mt-1">
                  Estimated refund to tenant:{' '}
                  <span className="font-semibold">
                    ${remainingToRefund.toFixed(2)}
                  </span>
                  {scenario === 'NO_REFUND' && remainingToRefund > 0
                    ? ' (Scenario and math do not match: scenario says no refund, but deductions are less than the deposit.)'
                    : null}
                </p>
              )}
            </div>
          </section>

          {/* Right column: compliance, evidence & checkout */}
          <section className="rounded-xl border border-amber-500/40 bg-slate-900/60 p-4 space-y-4">
            <h2 className="text-lg font-semibold">
              2. Compliance, evidence & defense summary
            </h2>

            <div className="flex items-center gap-3 text-[10px] font-semibold text-slate-200">
              {[
                { label: 'Case details', step: 1 },
                { label: 'Evidence', step: 2 },
                { label: 'Pay & download', step: 3 },
              ].map((s, idx) => (
                <div key={s.step} className="flex items-center gap-1">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-slate-950">
                    {s.step}
                  </span>
                  <span>{s.label}</span>
                  {idx < 2 && <span className="mx-1 text-slate-500">{'>'}</span>}
                </div>
              ))}
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-slate-300">Jurisdiction</span>
                <span className="font-medium">
                  {rule.name} ({rule.code})
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-300">Statutory deadline</span>
                <span className="font-medium">
                  {deadline
                    ? `${deadline} (${rule.deadlineDays} days after move-out)`
                    : 'Select a move-out date'}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-300">Deposit</span>
                <span className="font-medium">
                  {depositNumber !== null ? `$${depositNumber.toFixed(2)}` : '--'}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-300">Scenario</span>
                <span className="font-medium">
                  {SCENARIOS.find((s) => s.code === scenario)?.label}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-300">Interest required?</span>
                <span className="font-medium">
                  {rule.interestRequired ? 'Yes (jurisdiction-dependent)' : 'No'}
                </span>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <p className="text-slate-300">
                <span className="font-semibold">Statute: </span>
                {rule.statuteCitation}
              </p>
              <p className="text-slate-400">{rule.description}</p>
            </div>

            {/* Risk summary */}
            <div className="mt-2 rounded-lg border border-slate-700 bg-slate-950/60 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">
                  Dispute risk assessment
                </span>
                <span
                  className={`text-[10px] px-2 py-1 rounded-full ${
                    risk ? riskBadgeColor : 'bg-slate-700 text-slate-200'
                  }`}
                >
                  {risk ? `${risk.level} RISK` : 'ADD DATES & AMOUNTS'}
                </span>
              </div>

              <ul className="list-disc list-inside text-[11px] text-slate-300 space-y-1 max-h-32 overflow-y-auto">
                {risk ? (
                  risk.flags.map((f) => (
                    <li key={f.code + f.message}>{f.message}</li>
                  ))
                ) : (
                  <li>
                    Add move-out date, letter send date, deposit, and at least one
                    deduction to see timing and wear-and-tear risk.
                  </li>
                )}
              </ul>
            </div>

            {/* Evidence uploads */}
            <div className="mt-2 rounded-lg border border-slate-700 bg-slate-950/60 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">
                  Evidence uploads (optional but recommended)
                </span>
                <button
                  type="button"
                  onClick={addEvidenceRow}
                  className="text-[10px] px-2 py-1 rounded-md border border-amber-400 text-amber-200 hover:bg-amber-400 hover:text-slate-950 transition"
              >
                + Add file
              </button>
            </div>

            <p className="text-[11px] text-slate-400">
              Tip: link each photo/receipt to the matching line item so the PDF can reference it clearly.
            </p>

            {evidenceItems.length === 0 ? (
              <p className="text-[11px] text-slate-400">
                After you save the case, attach photos and receipts here. Each file
                can be mapped to a specific line-item charge.
              </p>
              ) : (
                <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                  {evidenceItems.map((e) => (
                    <div
                      key={e.id}
                      className="grid grid-cols-[1.4fr,0.9fr,0.9fr,auto] gap-2 items-center text-[11px]"
                    >
                      <div className="flex flex-col gap-1">
                        <input
                          type="file"
                          className="text-[10px] file:text-[10px] file:px-2 file:py-1 file:rounded-md file:border-0 file:bg-slate-800 file:text-slate-100"
                          onChange={(event) =>
                            updateEvidence(e.id, {
                              file: event.target.files?.[0] ?? null,
                              uploadStatus: 'PENDING',
                              error: undefined,
                            })
                          }
                        />
                        <input
                          className="rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-[10px] outline-none focus:ring-1 focus:ring-amber-400"
                          placeholder="Label (e.g. Kitchen floor before move-out)"
                          value={e.label}
                          onChange={(event) =>
                            updateEvidence(e.id, { label: event.target.value })
                          }
                        />
                      </div>

                      <select
                        className="rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-[10px] outline-none focus:ring-1 focus:ring-amber-400"
                        value={e.type}
                        onChange={(event) =>
                          updateEvidence(e.id, {
                            type: event.target.value as EvidenceKind,
                          })
                        }
                      >
                        <option value="PHOTO">Photo</option>
                        <option value="RECEIPT">Receipt</option>
                        <option value="OTHER">Other</option>
                      </select>

                      <select
                        className="rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-[10px] outline-none focus:ring-1 focus:ring-amber-400"
                        value={e.deductionId ?? ''}
                        onChange={(event) =>
                          updateEvidence(e.id, {
                            deductionId: event.target.value || null,
                          })
                        }
                      >
                        <option value="">Not linked</option>
                        {deductions.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.description || 'Untitled charge'}
                          </option>
                        ))}
                      </select>

                      <div className="flex flex-col items-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleUploadEvidence(e)}
                          className="text-[10px] px-2 py-1 rounded-md border border-slate-600 text-slate-100 hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
                          disabled={e.uploadStatus === 'UPLOADING'}
                        >
                          {e.uploadStatus === 'UPLOADED'
                            ? 'Re-upload'
                            : e.uploadStatus === 'UPLOADING'
                          ? 'Uploading...'
                            : 'Upload'}
                        </button>
                        {e.uploadStatus === 'UPLOADED' && (
                          <span className="text-[10px] text-emerald-400">
                            Uploaded
                          </span>
                        )}
                        {e.uploadStatus === 'ERROR' && e.error && (
                          <span className="text-[10px] text-red-400">
                            {e.error}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => removeEvidenceRow(e.id)}
                          className="text-[10px] text-slate-500 hover:text-red-400"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Save / payment / status */}
            {saveError && (
              <p className="text-xs text-red-400">
                {saveError}
              </p>
            )}
            {caseSavedMessage && savedCaseId && (
              <p className="text-xs text-emerald-400">
                {caseSavedMessage} ID:{' '}
                <span className="font-mono">{savedCaseId}</span>
              </p>
            )}
            {savedCaseId && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300">
                  Case ID: <span className="font-mono">{savedCaseId}</span>
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    paymentStatus === 'PAID'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/60'
                      : paymentStatus === 'PENDING'
                      ? 'bg-amber-400/20 text-amber-200 border border-amber-300/60'
                      : 'bg-slate-800 text-slate-200 border border-slate-600'
                  }`}
                >
                  {isLoadingCaseStatus && <span>Refreshing...</span>}
                  Payment {paymentStatus}
                </span>
              </div>
            )}
            {packetStatus && packetLetterKey && (
              <p className="text-xs text-emerald-300">
                Defense packet generated ({packetStatus}). Letter stored at S3
                key:{' '}
                <span className="font-mono break-all">{packetLetterKey}</span>
              </p>
            )}

            <div className="space-y-2">
              <button
                className="inline-flex items-center justify-center rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-50 hover:bg-slate-700 transition w-full disabled:opacity-60 disabled:cursor-not-allowed"
                type="button"
                onClick={handleSaveCaseClick}
                disabled={isSaving}
              >
                {isSaving ? 'Saving case...' : 'Save case (no payment yet)'}
              </button>

              <button
                className="inline-flex items-center justify-center rounded-md bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-300 transition w-full disabled:opacity-60 disabled:cursor-not-allowed"
                type="button"
                onClick={handleStartCheckout}
                disabled={isStartingCheckout || paymentStatus === 'PAID'}
              >
                {isStartingCheckout
                  ? 'Preparing secure checkout...'
                  : 'Review card & generate packet'}
              </button>

              {paymentError && (
                <p className="text-xs text-red-400">{paymentError}</p>
              )}
            </div>

            {clientSecret && (
              <div className="mt-3 rounded-lg border border-amber-500/40 bg-slate-950/50 p-3">
                <p className="text-[11px] text-amber-100 mb-2">
                  Your card details are processed by Stripe. We never see or store
                  them. When payment succeeds, your PDF packet is generated
                  automatically.
                </p>
                <Elements
                  stripe={stripePromise}
                  options={{
                    clientSecret,
                    appearance: {
                      theme: 'night',
                      variables: {
                        colorPrimary: '#fbbf24',
                      },
                    },
                  }}
                >
                  <PaymentForm onPaid={handleAfterPaid} />
                </Elements>
              </div>
            )}

            {showGeneratePacketButton && (
              <>
                <button
                  type="button"
                  onClick={handleGeneratePacketClick}
                  disabled={!canGeneratePacket || isGeneratingPacket}
                  className="mt-2 inline-flex items-center justify-center rounded-md border border-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-400 hover:text-slate-950 transition w-full disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isGeneratingPacket ? 'Generating packet...' : 'Generate defense packet'}
                </button>
                {!canGeneratePacket && (
                  <p className="text-[10px] text-slate-500 text-center">
                    Fill required fields and complete payment to generate.
                  </p>
                )}
              </>
            )}

            {packetStatus && packetLetterKey && (
              <button
                type="button"
                onClick={async () => {
                  if (!packetLetterKey) return;
                  if (!savedCaseToken) {
                    setSaveError('Missing case token. Please save the case again.');
                    return;
                  }
                  const { url } = await getDownloadUrl(packetLetterKey, savedCaseToken);
                  window.open(url, '_blank', 'noopener,noreferrer');
                }}
                className="mt-2 inline-flex items-center justify-center rounded-md border border-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-400 hover:text-slate-950 transition w-full"
              >
                Download tenant letter PDF again
              </button>
            )}

            <p className="text-[10px] text-slate-500 mt-2">
              This tool helps you follow statutory timelines and prepare
              documentation. It is not legal advice; verify requirements with local
              counsel.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

