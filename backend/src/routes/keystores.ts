import { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { genId } from "../utils.js";

/**
 * Keystore API: TG users encrypted keystore backup/restore.
 * Auth: TG initData validation (simplified here, full validation in TG Mini App).
 */
export async function keystoreRoutes(app: FastifyInstance) {
  // Upload/update keystore
  app.put<{
    Body: {
      telegramUserId: string;
      encryptedKeystore: string;
    };
  }>("/v1/keystores", async (request, reply) => {
    const { telegramUserId, encryptedKeystore } = request.body;

    if (!telegramUserId || !encryptedKeystore) {
      return reply
        .status(400)
        .send({ error: "telegramUserId and encryptedKeystore are required" });
    }

    // Upsert: check if exists
    const [existing] = await db
      .select()
      .from(schema.keystores)
      .where(eq(schema.keystores.telegramUserId, telegramUserId))
      .limit(1);

    if (existing) {
      await db
        .update(schema.keystores)
        .set({ encryptedKeystore, updatedAt: new Date() })
        .where(eq(schema.keystores.id, existing.id));
      return { id: existing.id, updated: true };
    }

    const id = genId("ks");
    await db.insert(schema.keystores).values({
      id,
      telegramUserId,
      encryptedKeystore,
    });

    return reply.status(201).send({ id, updated: false });
  });

  // Get keystore
  app.get<{
    Params: { telegramUserId: string };
  }>("/v1/keystores/:telegramUserId", async (request, reply) => {
    const { telegramUserId } = request.params;

    const [ks] = await db
      .select()
      .from(schema.keystores)
      .where(eq(schema.keystores.telegramUserId, telegramUserId))
      .limit(1);

    if (!ks) {
      return reply.status(404).send({ error: "keystore not found" });
    }

    return {
      id: ks.id,
      telegramUserId: ks.telegramUserId,
      encryptedKeystore: ks.encryptedKeystore,
      updatedAt: ks.updatedAt,
    };
  });

  // Delete keystore
  app.delete<{
    Params: { telegramUserId: string };
  }>("/v1/keystores/:telegramUserId", async (request, reply) => {
    const { telegramUserId } = request.params;

    const [ks] = await db
      .select()
      .from(schema.keystores)
      .where(eq(schema.keystores.telegramUserId, telegramUserId))
      .limit(1);

    if (!ks) {
      return reply.status(404).send({ error: "keystore not found" });
    }

    await db
      .delete(schema.keystores)
      .where(eq(schema.keystores.id, ks.id));

    return { deleted: true };
  });
}
