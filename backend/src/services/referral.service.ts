import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { genId } from "../utils";
import crypto from "crypto";

export async function createReferrer(walletAddress: string) {
  // Check if already registered
  const [existing] = await db
    .select()
    .from(schema.referrers)
    .where(eq(schema.referrers.walletAddress, walletAddress))
    .limit(1);

  if (existing) return existing;

  const id = genId("ref");
  const code = crypto.randomBytes(4).toString("hex"); // 8-char code

  const [referrer] = await db
    .insert(schema.referrers)
    .values({
      id,
      walletAddress,
      code,
      feeBps: 20, // default 0.2%
    })
    .returning();

  return referrer;
}

export async function getReferrerByCode(code: string) {
  const [referrer] = await db
    .select()
    .from(schema.referrers)
    .where(eq(schema.referrers.code, code))
    .limit(1);
  return referrer;
}

export async function getReferrerByWallet(walletAddress: string) {
  const [referrer] = await db
    .select()
    .from(schema.referrers)
    .where(eq(schema.referrers.walletAddress, walletAddress))
    .limit(1);
  return referrer;
}
