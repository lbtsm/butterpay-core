import { API_BASE_URL } from "./config";

export interface Invoice {
  id: string;
  merchantId: string;
  merchantOrderId?: string;
  amount: string;
  token: string;
  chain: string;
  status: string;
  payerAddress?: string;
  txHash?: string;
  serviceFee?: string;
  merchantReceived?: string;
  description?: string;
  expiresAt?: string;
  redirectUrl?: string;
  createdAt: string;
}

export async function fetchInvoice(id: string): Promise<Invoice> {
  const res = await fetch(`${API_BASE_URL}/v1/invoices/${id}`);
  if (!res.ok) throw new Error("Invoice not found");
  return res.json();
}

export async function submitTransaction(
  invoiceId: string,
  params: { txHash: string; payerAddress: string; toAddress: string; chain: string; token: string }
) {
  const res = await fetch(`${API_BASE_URL}/v1/invoices/${invoiceId}/tx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Failed to submit transaction");
  return res.json();
}

export async function pollInvoiceStatus(id: string, timeoutMs = 300_000): Promise<Invoice> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const invoice = await fetchInvoice(id);
    if (invoice.status === "confirmed" || invoice.status === "failed") {
      return invoice;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Timeout waiting for confirmation");
}
