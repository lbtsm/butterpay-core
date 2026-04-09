import { eq, and, lte, desc } from "drizzle-orm";
import { db, schema } from "../db";
import { genId } from "../utils";

export interface CreateSubscriptionInput {
  merchantId: string;
  subscriberAddress: string;
  chain: string;
  token: string;
  amount: string;
  intervalSeconds: number;
  onChainId?: number;
  expiresAt?: Date;
}

export async function createSubscription(input: CreateSubscriptionInput) {
  const id = genId("sub");
  const nextChargeAt = new Date(Date.now() + input.intervalSeconds * 1000);

  const [sub] = await db
    .insert(schema.subscriptions)
    .values({
      id,
      merchantId: input.merchantId,
      subscriberAddress: input.subscriberAddress,
      chain: input.chain,
      token: input.token,
      amount: input.amount,
      interval: input.intervalSeconds,
      onChainId: input.onChainId,
      nextChargeAt,
      lastChargedAt: new Date(),
      expiresAt: input.expiresAt,
    })
    .returning();

  return sub;
}

export async function getSubscription(id: string) {
  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, id))
    .limit(1);
  return sub;
}

export async function cancelSubscription(id: string) {
  const [sub] = await db
    .update(schema.subscriptions)
    .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.subscriptions.id, id))
    .returning();
  return sub;
}

export async function getDueSubscriptions(limit = 50) {
  return db
    .select()
    .from(schema.subscriptions)
    .where(
      and(
        eq(schema.subscriptions.status, "active"),
        lte(schema.subscriptions.nextChargeAt, new Date())
      )
    )
    .orderBy(schema.subscriptions.nextChargeAt)
    .limit(limit);
}

export async function markCharged(id: string, intervalSeconds: number) {
  const now = new Date();
  const nextChargeAt = new Date(now.getTime() + intervalSeconds * 1000);

  await db
    .update(schema.subscriptions)
    .set({ lastChargedAt: now, nextChargeAt, updatedAt: now })
    .where(eq(schema.subscriptions.id, id));
}

export async function markFailed(id: string) {
  await db
    .update(schema.subscriptions)
    .set({ status: "past_due", updatedAt: new Date() })
    .where(eq(schema.subscriptions.id, id));
}

export async function listSubscriptions(merchantId: string, status?: string) {
  const conditions = [eq(schema.subscriptions.merchantId, merchantId)];
  if (status) conditions.push(eq(schema.subscriptions.status, status));

  return db
    .select()
    .from(schema.subscriptions)
    .where(and(...conditions))
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(100);
}
