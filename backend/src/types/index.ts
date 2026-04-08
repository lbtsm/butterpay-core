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
  /** Amount in USD (e.g. "10.00"). Auto-matched to chain stablecoin. */
  amountUsd: string;
  /** Preferred chain (optional — user can change on payment page) */
  chain?: Chain;
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
  amountUsd?: string;
  token?: Token;
  chain?: Chain;
  tokenAmount?: string;
  serviceFee?: string;
  merchantReceived?: string;
  paymentMethod?: PaymentMethod;
  txHash?: string;
  timestamp: string;
}

export interface QuoteRequest {
  inputToken: string;     // token address or symbol (e.g. "WETH")
  outputToken: string;    // stablecoin (e.g. "USDT")
  inputAmount: string;    // human-readable
  chain: Chain;
}

export interface QuoteResponse {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  outputAmount: string;
  minOutputAmount: string; // with slippage buffer
  priceImpact: string;
  dexRouter: string;
  dexCalldata: string;
  expiresAt: string;
}
