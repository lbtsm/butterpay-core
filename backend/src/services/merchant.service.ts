import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { genId, genApiKey, genSecret } from "../utils";

export interface CreateMerchantInput {
  name: string;
  email?: string;
  webhookUrl?: string;
  receivingAddresses?: Record<string, string>;
  serviceFeeBps?: number;
}

export async function createMerchant(input: CreateMerchantInput) {
  const id = genId("mer");
  const apiKey = genApiKey();
  const apiSecret = genSecret();
  const webhookSecret = genSecret();

  const [merchant] = await db
    .insert(schema.merchants)
    .values({
      id,
      name: input.name,
      email: input.email,
      apiKey,
      apiSecret,
      webhookUrl: input.webhookUrl,
      webhookSecret,
      receivingAddresses: input.receivingAddresses || {},
      serviceFeeBps: input.serviceFeeBps ?? 80,
    })
    .returning();

  return { ...merchant, apiKey, apiSecret };
}

export async function getMerchant(id: string) {
  const [merchant] = await db
    .select()
    .from(schema.merchants)
    .where(eq(schema.merchants.id, id))
    .limit(1);
  return merchant;
}

export async function getMerchantByApiKey(apiKey: string) {
  const [merchant] = await db
    .select()
    .from(schema.merchants)
    .where(eq(schema.merchants.apiKey, apiKey))
    .limit(1);
  return merchant;
}

export async function updateMerchant(
  id: string,
  updates: Partial<{
    name: string;
    email: string;
    webhookUrl: string;
    receivingAddresses: Record<string, string>;
    serviceFeeBps: number;
    active: boolean;
  }>
) {
  const [merchant] = await db
    .update(schema.merchants)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(schema.merchants.id, id))
    .returning();
  return merchant;
}
