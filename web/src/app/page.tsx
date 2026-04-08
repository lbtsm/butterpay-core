export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="max-w-lg text-center p-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">ButterPay</h1>
        <p className="text-lg text-gray-600 mb-8">
          Crypto payment infrastructure. Accept any token, receive stablecoins.
        </p>
        <div className="space-y-3">
          <a
            href="https://github.com/lbtsm/butterpay-core"
            className="block bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 px-6 rounded-xl transition"
          >
            Documentation
          </a>
          <p className="text-sm text-gray-400">
            Payment pages are at <code className="bg-gray-100 px-2 py-1 rounded">/pay/[invoiceId]</code>
          </p>
        </div>
      </div>
    </main>
  );
}
