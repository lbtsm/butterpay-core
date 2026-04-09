import { FastifyInstance } from "fastify";
import { createFiatOrder, handleFiatCallback } from "../services/fiat.service";

export async function fiatRoutes(app: FastifyInstance) {
  // Create fiat payment (user chooses credit card)
  app.post<{
    Body: {
      invoiceId: string;
      returnUrl?: string;
    };
  }>("/v1/fiat/pay", {
    handler: async (request, reply) => {
      const { invoiceId, returnUrl } = request.body;

      if (!invoiceId) {
        return reply.status(400).send({ error: "invoiceId is required" });
      }

      try {
        const result = await createFiatOrder(invoiceId, returnUrl);
        return result;
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    },
  });

  // TrustPay callback (called by TrustPay servers)
  app.post("/v1/fiat/callback", {
    handler: async (request, reply) => {
      try {
        await handleFiatCallback(request.body, request.headers as Record<string, string>);
        return reply.status(200).send({ ok: true });
      } catch (err: any) {
        console.error("[fiat-callback] Error:", err.message);
        return reply.status(500).send({ error: "callback processing failed" });
      }
    },
  });
}
