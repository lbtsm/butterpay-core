"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchTransactions, fetchSummary, fetchMerchant } from "@/lib/dashboard-api";

interface Transaction {
  id: string;
  amount: string;
  token: string;
  chain: string;
  status: string;
  txHash?: string;
  payerAddress?: string;
  merchantOrderId?: string;
  createdAt: string;
}

interface Summary {
  totalCount: number;
  totalAmount: string;
  totalServiceFee: string;
  totalMerchantReceived: string;
}

export default function Dashboard() {
  const [apiKey, setApiKey] = useState("");
  const [authed, setAuthed] = useState(false);
  const [merchant, setMerchant] = useState<any>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");

  const login = useCallback(async () => {
    if (!apiKey.trim()) return;
    setLoading(true);
    setError("");
    try {
      const m = await fetchMerchant(apiKey);
      setMerchant(m);
      setAuthed(true);
    } catch {
      setError("Invalid API key");
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  const loadData = useCallback(async () => {
    if (!authed) return;
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;

      const [txRes, sumRes] = await Promise.all([
        fetchTransactions(apiKey, params),
        fetchSummary(apiKey),
      ]);
      setTransactions(txRes.data || []);
      setSummary(sumRes);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [authed, apiKey, statusFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const exportCsv = () => {
    const rows = [
      ["ID", "Amount (USD)", "Token", "Chain", "Status", "Tx Hash", "Payer", "Created"],
      ...transactions.map((t) => [
        t.id, t.amount, t.token, t.chain, t.status,
        t.txHash || "", t.payerAddress || "", t.createdAt,
      ]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `butterpay-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  // Login screen
  if (!authed) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-white rounded-2xl shadow-lg p-6">
          <h1 className="text-2xl font-bold text-center mb-6">Merchant Dashboard</h1>
          {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">{error}</div>}
          <input
            type="password"
            placeholder="Enter API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login()}
            className="w-full border border-gray-300 rounded-xl px-4 py-3 mb-4 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <button
            onClick={login}
            disabled={loading}
            className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 rounded-xl transition"
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </div>
      </main>
    );
  }

  // Dashboard
  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold">ButterPay Dashboard</h1>
            <p className="text-sm text-gray-500">{merchant?.name}</p>
          </div>
          <button onClick={() => { setAuthed(false); setApiKey(""); }} className="text-sm text-gray-500 hover:text-gray-700">
            Logout
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card label="Total Transactions" value={String(summary.totalCount)} />
            <Card label="Total Volume (USD)" value={`$${parseFloat(summary.totalAmount).toFixed(2)}`} />
            <Card label="Service Fees" value={`$${parseFloat(summary.totalServiceFee).toFixed(2)}`} />
            <Card label="Merchant Received" value={`$${parseFloat(summary.totalMerchantReceived).toFixed(2)}`} />
          </div>
        )}

        {/* Filters + Export */}
        <div className="flex items-center gap-4">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            <option value="created">Created</option>
            <option value="initiated">Initiated</option>
            <option value="confirmed">Confirmed</option>
            <option value="failed">Failed</option>
          </select>
          <button onClick={loadData} className="text-sm text-amber-600 hover:underline">
            Refresh
          </button>
          <button onClick={exportCsv} className="ml-auto text-sm bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg">
            Export CSV
          </button>
        </div>

        {/* Transaction Table */}
        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 font-medium text-gray-500">Invoice</th>
                <th className="text-left p-3 font-medium text-gray-500">Amount</th>
                <th className="text-left p-3 font-medium text-gray-500">Token</th>
                <th className="text-left p-3 font-medium text-gray-500">Chain</th>
                <th className="text-left p-3 font-medium text-gray-500">Status</th>
                <th className="text-left p-3 font-medium text-gray-500">Tx Hash</th>
                <th className="text-left p-3 font-medium text-gray-500">Date</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr><td colSpan={7} className="p-6 text-center text-gray-400">No transactions yet</td></tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="p-3 font-mono text-xs">{tx.id}</td>
                    <td className="p-3">${parseFloat(tx.amount).toFixed(2)}</td>
                    <td className="p-3">{tx.token}</td>
                    <td className="p-3 capitalize">{tx.chain}</td>
                    <td className="p-3">
                      <StatusBadge status={tx.status} />
                    </td>
                    <td className="p-3 font-mono text-xs truncate max-w-[120px]">
                      {tx.txHash || "-"}
                    </td>
                    <td className="p-3 text-gray-500">
                      {new Date(tx.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl shadow p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    created: "bg-gray-100 text-gray-600",
    initiated: "bg-blue-100 text-blue-700",
    confirmed: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
    expired: "bg-yellow-100 text-yellow-700",
  };
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status] || "bg-gray-100"}`}>
      {status}
    </span>
  );
}
