import { db, schema } from "../db";
import { eq } from "drizzle-orm";
import { genId, hmacSign } from "../utils";
import type { WebhookPayload } from "../types";

export async function sendWebhook(
  invoiceId: string,
  payload: WebhookPayload
) {
  // Get invoice to find webhook URL
  const [invoice] = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.id, invoiceId))
    .limit(1);

  if (!invoice) return;

  // Get merchant for webhook config
  const [merchant] = await db
    .select()
    .from(schema.merchants)
    .where(eq(schema.merchants.id, invoice.merchantId))
    .limit(1);

  if (!merchant) return;

  const url = invoice.webhookUrl || merchant.webhookUrl;
  if (!url) return;

  const secret = merchant.webhookSecret || "";
  const body = JSON.stringify(payload);
  const signature = hmacSign(body, secret);

  const logId = genId("whl");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ButterPay-Signature": signature,
        "X-ButterPay-Event": payload.event,
      },
      body,
      signal: AbortSignal.timeout(10000),
    });

    await db.insert(schema.webhookLogs).values({
      id: logId,
      invoiceId,
      event: payload.event,
      url,
      payload,
      statusCode: res.status,
      response: await res.text().catch(() => ""),
      attempts: 1,
      success: res.ok,
    });
  } catch (err: any) {
    await db.insert(schema.webhookLogs).values({
      id: logId,
      invoiceId,
      event: payload.event,
      url,
      payload,
      statusCode: 0,
      response: err.message,
      attempts: 1,
      success: false,
      nextRetryAt: new Date(Date.now() + 10000), // retry in 10s
    });
  }
}
