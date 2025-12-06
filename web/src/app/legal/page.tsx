'use client';

export default function LegalPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-4 py-10 flex items-center justify-center">
      <div className="w-full max-w-3xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold">Legal & Privacy</h1>
          <p className="text-sm text-slate-300">
            This is a lightweight summary of how we handle your data and what this product is (and is not).
          </p>
        </header>

        <section className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-lg font-semibold">Disclaimer</h2>
          <p className="text-sm text-slate-200">
            This tool is not legal advice. Statutes vary by jurisdiction, and you should confirm deadlines,
            documentation, and remedies with local counsel. Use at your own discretion.
          </p>
        </section>

        <section className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-lg font-semibold">Privacy</h2>
          <ul className="list-disc list-inside text-sm text-slate-200 space-y-1">
            <li>We store case details, deductions, and evidence references to generate your packet.</li>
            <li>Evidence files are kept in private storage and accessed only via short-lived presigned URLs.</li>
            <li>Payment is processed by Stripe; we do not store card numbers.</li>
          </ul>
        </section>

        <section className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-lg font-semibold">Contact</h2>
          <p className="text-sm text-slate-200">
            Questions or takedown requests? Email the team so we can help quickly.
          </p>
        </section>
      </div>
    </main>
  );
}
