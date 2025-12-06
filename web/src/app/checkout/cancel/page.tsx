export default function CancelPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-xl text-red-400">Payment Cancelled</h1>
        <a href="/" className="text-slate-400 underline">Return Home</a>
      </div>
    </main>
  );
}