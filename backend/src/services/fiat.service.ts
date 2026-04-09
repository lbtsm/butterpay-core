import { db, schema } from "../db";
import { eq } from "drizzle-orm";
import { genId } from "../utils";
import { updateInvoiceStatus } from "./invoice.service";
import { sendWebhook } from "./webhook.service";

// ========================= FiatPaymentProvider Interface =========================

export interface FiatPaymentProvider {
  /** Create a fiat payment order, return redirect URL for user */
  createOrder(params: {
    invoiceId: string;
    amountUsd: string;
    currency: string;
    description?: string;
    returnUrl?: string;
    callbackUrl: string;
  }): Promise<{ orderId: string; redirectUrl: string }>;

  /** Query order status */
  queryOrder(orderId: string): Promise<{ status: string; paidAmount?: string }>;

  /** Handle webhook callback from provider */
  handleCallback(body: unknown, headers: Record<string, string>): Promise<{
    orderId: string;
    status: "success" | "failed";
    paidAmount?: string;
  }>;
}

// ========================= TrustPay Provider =========================

export class TrustPayProvider implements FiatPaymentProvider {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.TRUSTPAY_API_KEY || "";
    this.apiSecret = process.env.TRUSTPAY_API_SECRET || "";
    this.baseUrl = process.env.TRUSTPAY_BASE_URL || "https://api.trustpay.com";
  }

  async createOrder(params: {
    invoiceId: string;
    amountUsd: string;
    currency: string;
    description?: string;
    returnUrl?: string;
    callbackUrl: string;
  }) {
    // TODO: Real TrustPay API integration
    // For now, return a placeholder
    const orderId = `tp_${genId("ord")}`;

    return {
      orderId,
      redirectUrl: `${this.baseUrl}/checkout/${orderId}`,
    };
  }

  async queryOrder(orderId: string) {
    // TODO: Real TrustPay API query
    return { status: "pending" };
  }

  async handleCallback(body: unknown, headers: Record<string, string>) {
    // TODO: Verify TrustPay signature, parse callback
    const data = body as any;
    return {
      orderId: data.orderId || "",
      status: (data.status === "completed" ? "success" : "failed") as "success" | "failed",
      paidAmount: data.amount,
    };
  }
}

// ========================= Fiat Order Management =========================

let fiatProvider: FiatPaymentProvider = new TrustPayProvider();

export function setFiatProvider(provider: FiatPaymentProvider) {
  fiatProvider = provider;
}

export async function createFiatOrder(invoiceId: string, returnUrl?: string) {
  const [invoice] = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.id, invoiceId))
    .limit(1);

  if (!invoice) throw new Error("Invoice not found");
  if (invoice.status !== "created") throw new Error(`Invoice is ${invoice.status}`);

  const callbackUrl = `${process.env.API_BASE_URL || "http://localhost:3000"}/v1/fiat/callback`;

  const { orderId, redirectUrl } = await fiatProvider.createOrder({
    invoiceId: invoice.id,
    amountUsd: invoice.amount,
    currency: "USD",
    description: invoice.description || undefined,
    returnUrl,
    callbackUrl,
  });

  // Store fiat order mapping
  // Using invoices metadata to track fiat order (or a separate fiat_orders table)
  await db
    .update(schema.invoices)
    .set({
      paymentMethod: "fiat",
      metadata: { ...(invoice.metadata as any), fiatOrderId: orderId },
      updatedAt: new Date(),
    })
    .where(eq(schema.invoices.id, invoiceId));

  return { orderId, redirectUrl };
}

export async function handleFiatCallback(body: unknown, headers: Record<string, string>) {
  const result = await fiatProvider.handleCallback(body, headers);

  // Find invoice by fiat order ID
  // In production, use a dedicated fiat_orders table for lookup
  // For now, search in metadata
  const invoices = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.paymentMethod, "fiat"))
    .limit(100);

  const invoice = invoices.find(
    (inv) => (inv.metadata as any)?.fiatOrderId === result.orderId
  );

  if (!invoice) {
    console.error(`[fiat] No invoice found for fiat order ${result.orderId}`);
    return;
  }

  if (result.status === "success") {
    await updateInvoiceStatus(invoice.id, "confirmed", {
      confirmedAt: new Date(),
    });

    await sendWebhook(invoice.id, {
      event: "payment.confirmed",
      invoiceId: invoice.id,
      merchantOrderId: invoice.merchantOrderId || undefined,
      amountUsd: invoice.amount,
      paymentMethod: "fiat",
      timestamp: new Date().toISOString(),
    });
  } else {
    await updateInvoiceStatus(invoice.id, "failed");

    await sendWebhook(invoice.id, {
      event: "payment.failed",
      invoiceId: invoice.id,
      merchantOrderId: invoice.merchantOrderId || undefined,
      paymentMethod: "fiat",
      timestamp: new Date().toISOString(),
    });
  }
}
