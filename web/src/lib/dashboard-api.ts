import { API_BASE_URL } from "./config";

function headers(apiKey: string) {
  return { "Content-Type": "application/json", "X-API-Key": apiKey };
}

export async function fetchTransactions(apiKey: string, params?: Record<string, string>) {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetch(`${API_BASE_URL}/v1/transactions${qs}`, { headers: headers(apiKey) });
  if (!res.ok) throw new Error("Failed to fetch transactions");
  return res.json();
}

export async function fetchSummary(apiKey: string, params?: Record<string, string>) {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetch(`${API_BASE_URL}/v1/transactions/summary${qs}`, { headers: headers(apiKey) });
  if (!res.ok) throw new Error("Failed to fetch summary");
  return res.json();
}

export async function fetchMerchant(apiKey: string) {
  const res = await fetch(`${API_BASE_URL}/v1/merchants/me`, { headers: headers(apiKey) });
  if (!res.ok) throw new Error("Invalid API key");
  return res.json();
}
