import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { genId } from "../utils";
import type { CreateInvoiceInput, InvoiceStatus } from "../types";

const DEFAULT_EXPIRY_MINUTES = 30;

export async function createInvoice(input: CreateInvoiceInput) {
  const id = genId("inv");
  const expiresAt = new Date(
    Date.now() + DEFAULT_EXPIRY_MINUTES * 60 * 1000
  );

  // Look up merchant to get service fee config
  const [merchant] = await db
    .select()
    .from(schema.merchants)
    .where(eq(schema.merchants.id, input.merchantId))
    .limit(1);

  if (!merchant) throw new Error("merchant not found");

  const amount = input.amount;
  const serviceFeeBps = merchant.serviceFeeBps;
  const serviceFee = (
    (parseFloat(amount) * serviceFeeBps) /
    10000
  ).toFixed(18);
  const merchantReceived = (
    parseFloat(amount) - parseFloat(serviceFee)
  ).toFixed(18);

  const [invoice] = await db
    .insert(schema.invoices)
    .values({
      id,
      merchantId: input.merchantId,
      merchantOrderId: input.merchantOrderId,
      amount,
      token: input.token,
      chain: input.chain,
      description: input.description,
      metadata: input.metadata,
      redirectUrl: input.redirectUrl,
      webhookUrl: input.webhookUrl,
      serviceFee,
      merchantReceived,
      expiresAt,
    })
    .returning();

  return invoice;
}

export async function getInvoice(id: string) {
  const [invoice] = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.id, id))
    .limit(1);
  return invoice;
}

export async function updateInvoiceStatus(
  id: string,
  status: InvoiceStatus,
  extra?: Partial<{
    txHash: string;
    payerAddress: string;
    paymentMethod: string;
    confirmedAt: Date;
  }>
) {
  const [invoice] = await db
    .update(schema.invoices)
    .set({ status, ...extra, updatedAt: new Date() })
    .where(eq(schema.invoices.id, id))
    .returning();
  return invoice;
}

export async function listInvoices(params: {
  merchantId: string;
  status?: InvoiceStatus;
  chain?: string;
  token?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}) {
  const conditions = [eq(schema.invoices.merchantId, params.merchantId)];

  if (params.status) {
    conditions.push(eq(schema.invoices.status, params.status));
  }
  if (params.chain) {
    conditions.push(eq(schema.invoices.chain, params.chain));
  }
  if (params.token) {
    conditions.push(eq(schema.invoices.token, params.token));
  }
  if (params.from) {
    conditions.push(gte(schema.invoices.createdAt, params.from));
  }
  if (params.to) {
    conditions.push(lte(schema.invoices.createdAt, params.to));
  }

  const rows = await db
    .select()
    .from(schema.invoices)
    .where(and(...conditions))
    .orderBy(desc(schema.invoices.createdAt))
    .limit(params.limit ?? 50)
    .offset(params.offset ?? 0);

  return rows;
}

export async function getTransactionsSummary(
  merchantId: string,
  from?: Date,
  to?: Date
) {
  const conditions = [
    eq(schema.invoices.merchantId, merchantId),
    eq(schema.invoices.status, "confirmed"),
  ];
  if (from) conditions.push(gte(schema.invoices.createdAt, from));
  if (to) conditions.push(lte(schema.invoices.createdAt, to));

  const [result] = await db
    .select({
      totalCount: sql<number>`count(*)::int`,
      totalAmount: sql<string>`coalesce(sum(${schema.invoices.amount}::numeric), 0)::text`,
      totalServiceFee: sql<string>`coalesce(sum(${schema.invoices.serviceFee}::numeric), 0)::text`,
      totalMerchantReceived: sql<string>`coalesce(sum(${schema.invoices.merchantReceived}::numeric), 0)::text`,
    })
    .from(schema.invoices)
    .where(and(...conditions));

  return result;
}
