import { FastifyInstance } from "fastify";
import * as referralService from "../services/referral.service";

export async function referrerRoutes(app: FastifyInstance) {
  // Register as referrer (self-service, connect wallet)
  app.post<{
    Body: { walletAddress: string };
  }>("/v1/referrers", {
    handler: async (request, reply) => {
      const { walletAddress } = request.body;

      if (!walletAddress) {
        return reply.status(400).send({ error: "walletAddress is required" });
      }

      const referrer = await referralService.createReferrer(walletAddress);

      return reply.status(201).send({
        id: referrer.id,
        walletAddress: referrer.walletAddress,
        code: referrer.code,
        feeBps: referrer.feeBps,
        // SDK snippet for integration
        sdkSnippet: `<ButterPayProvider config={{ apiUrl: "...", referrer: "${referrer.code}" }}>`,
      });
    },
  });

  // Lookup referrer by code
  app.get<{ Params: { code: string } }>("/v1/referrers/:code", {
    handler: async (request, reply) => {
      const referrer = await referralService.getReferrerByCode(request.params.code);
      if (!referrer || !referrer.active) {
        return reply.status(404).send({ error: "referrer not found" });
      }
      return {
        code: referrer.code,
        walletAddress: referrer.walletAddress,
        feeBps: referrer.feeBps,
      };
    },
  });
}
