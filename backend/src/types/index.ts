export type Chain =
  | "ethereum"
  | "arbitrum"
  | "bsc"
  | "polygon"
  | "optimism";

export type InvoiceStatus =
  | "created"
  | "initiated"
  | "confirmed"
  | "failed"
  | "expired"
  | "refunded";

export type PaymentMethod = "crypto" | "fiat";

export type Token = "USDT" | "USDC";

export interface CreateInvoiceInput {
  merchantId: string;
  amount: string; // decimal string, e.g. "10.00"
  token: Token;
  chain: Chain;
  description?: string;
  merchantOrderId?: string;
  metadata?: Record<string, unknown>;
  redirectUrl?: string;
  webhookUrl?: string;
}

export interface WebhookPayload {
  event: "payment.initiated" | "payment.confirmed" | "payment.failed";
  invoiceId: string;
  merchantOrderId?: string;
  amount?: string;
  serviceFee?: string;
  merchantReceived?: string;
  paymentMethod?: PaymentMethod;
  chain?: Chain;
  token?: Token;
  txHash?: string;
  timestamp: string;
}
