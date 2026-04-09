"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { API_BASE_URL } from "@/lib/config";

export default function PaymentLinkPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>}>
      <PaymentLinkContent />
    </Suspense>
  );
}

/**
 * Payment link page: /pay/link?amount=10&description=Tip&apiKey=bp_xxx
 *
 * Supports:
 * - Fixed amount: amount param pre-filled, user just clicks pay
 * - Custom amount (tips): amount param empty or absent, user enters amount
 */
function PaymentLinkContent() {
  const searchParams = useSearchParams();
  const fixedAmount = searchParams.get("amount") || "";
  const description = searchParams.get("description") || "Payment";
  const apiKey = searchParams.get("apiKey") || "";
  const redirectUrl = searchParams.get("redirect") || "";

  const [amount, setAmount] = useState(fixedAmount);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isCustomAmount = !fixedAmount;

  const handlePay = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      setError("Please enter a valid amount");
      return;
    }
    setLoading(true);
    setError("");

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["X-API-Key"] = apiKey;

      const res = await fetch(`${API_BASE_URL}/v1/invoices`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          amountUsd: amount,
          description,
          redirectUrl: redirectUrl || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Failed to create invoice");
      }

      const invoice = await res.json();
      window.location.href = `/pay/${invoice.id}`;
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-6">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold">ButterPay</h1>
          <p className="text-gray-500 mt-1">{description}</p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">{error}</div>
        )}

        {isCustomAmount ? (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Amount (USD)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-3 text-gray-400 text-lg">$</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full border border-gray-300 rounded-xl pl-8 pr-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                autoFocus
              />
            </div>
          </div>
        ) : (
          <div className="text-center mb-6">
            <p className="text-4xl font-bold">${fixedAmount}</p>
            <p className="text-gray-400 text-sm mt-1">USD</p>
          </div>
        )}

        <button
          onClick={handlePay}
          disabled={loading || !amount}
          className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white font-semibold py-3 px-4 rounded-xl transition"
        >
          {loading ? "Creating payment..." : `Pay $${amount || "0.00"}`}
        </button>

        <p className="text-center text-xs text-gray-400 mt-6">
          Powered by ButterPay
        </p>
      </div>
    </main>
  );
}
