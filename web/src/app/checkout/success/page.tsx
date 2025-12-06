'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { generatePacket, getDownloadUrl } from '@/lib/api';

type Status = 'idle' | 'working' | 'done' | 'error';

function SuccessContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status>('idle');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const caseId = searchParams.get('caseId');
    const caseToken =
      typeof window !== 'undefined' && caseId
        ? window.localStorage.getItem(`deposit:caseToken:${caseId}`)
        : null;

    if (!caseId || !caseToken) {
      setError('Missing case ID or token. Return to the app to finish your packet.');
      setStatus('error');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setStatus('working');

        const packet = await generatePacket(caseId, caseToken);
        const letterKey = packet.objects?.letter;
        if (!letterKey) {
          throw new Error('No letter key returned from packet generator');
        }

        const { url } = await getDownloadUrl(letterKey, caseToken);
        if (!cancelled) {
          setDownloadUrl(url);
          setStatus('done');
        }
      } catch (err: unknown) {
        console.error(err);
        if (!cancelled) {
          const message =
            err instanceof Error
              ? err.message
              : typeof err === 'string'
              ? err
              : 'Something went wrong';
          setError(message);
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-4">
        <h1 className="text-2xl font-bold">Payment complete</h1>

        {status === 'working' && (
          <p className="text-slate-300 text-sm">Preparing your defense packet...</p>
        )}

        {status === 'done' && downloadUrl && (
          <div className="space-y-3">
            <p className="text-slate-300 text-sm">
              Your packet is ready. You can download the tenant letter below.
            </p>
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-md bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-300 transition"
            >
              Download tenant letter PDF
            </a>
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-md bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-50 hover:bg-slate-700 transition"
            >
              Back to the app
            </Link>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-2">
            <p className="text-sm text-red-400">
              {error || 'There was a problem preparing your packet.'}
            </p>
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-md bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-50 hover:bg-slate-700 transition"
            >
              Return to the app
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={null}>
      <SuccessContent />
    </Suspense>
  );
}
