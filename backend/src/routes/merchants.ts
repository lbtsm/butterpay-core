import { FastifyInstance } from "fastify";
import * as merchantService from "../services/merchant.service";

export async function merchantRoutes(app: FastifyInstance) {
  // Create merchant (admin endpoint, no auth for now)
  app.post<{
    Body: {
      name: string;
      email?: string;
      webhookUrl?: string;
      receivingAddresses?: Record<string, string>;
      serviceFeeBps?: number;
    };
  }>("/v1/merchants", async (request, reply) => {
    const { name, email, webhookUrl, receivingAddresses, serviceFeeBps } =
      request.body;

    if (!name) {
      return reply.status(400).send({ error: "name is required" });
    }

    const merchant = await merchantService.createMerchant({
      name,
      email,
      webhookUrl,
      receivingAddresses,
      serviceFeeBps,
    });

    return reply.status(201).send({
      id: merchant.id,
      name: merchant.name,
      apiKey: merchant.apiKey,
      apiSecret: merchant.apiSecret,
      serviceFeeBps: merchant.serviceFeeBps,
      createdAt: merchant.createdAt,
    });
  });

  // Get merchant (requires API key)
  app.get("/v1/merchants/me", {
    preHandler: [app.apiKeyAuth],
    handler: async (request, reply) => {
      const merchant = await merchantService.getMerchant(request.merchant!.id);
      if (!merchant) {
        return reply.status(404).send({ error: "not found" });
      }
      return {
        id: merchant.id,
        name: merchant.name,
        email: merchant.email,
        webhookUrl: merchant.webhookUrl,
        receivingAddresses: merchant.receivingAddresses,
        serviceFeeBps: merchant.serviceFeeBps,
        createdAt: merchant.createdAt,
      };
    },
  });

  // Update merchant
  app.patch<{
    Body: Partial<{
      name: string;
      email: string;
      webhookUrl: string;
      receivingAddresses: Record<string, string>;
    }>;
  }>("/v1/merchants/me", {
    preHandler: [app.apiKeyAuth],
    handler: async (request, reply) => {
      const merchant = await merchantService.updateMerchant(
        request.merchant!.id,
        request.body
      );
      return merchant;
    },
  });
}
