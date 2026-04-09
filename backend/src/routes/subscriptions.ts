import { FastifyInstance } from "fastify";
import * as subService from "../services/subscription.service";

export async function subscriptionRoutes(app: FastifyInstance) {
  // Create subscription
  app.post<{
    Body: {
      subscriberAddress: string;
      chain: string;
      token: string;
      amount: string;
      intervalSeconds: number;
      onChainId?: number;
      expiresAt?: string;
    };
  }>("/v1/subscriptions", {
    preHandler: [app.apiKeyAuth],
    handler: async (request, reply) => {
      const { subscriberAddress, chain, token, amount, intervalSeconds, onChainId, expiresAt } =
        request.body;

      if (!subscriberAddress || !chain || !token || !amount || !intervalSeconds) {
        return reply.status(400).send({ error: "Missing required fields" });
      }

      const sub = await subService.createSubscription({
        merchantId: request.merchant!.id,
        subscriberAddress,
        chain,
        token,
        amount,
        intervalSeconds,
        onChainId,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      });

      return reply.status(201).send(sub);
    },
  });

  // Get subscription
  app.get<{ Params: { id: string } }>("/v1/subscriptions/:id", {
    preHandler: [app.apiKeyAuth],
    handler: async (request, reply) => {
      const sub = await subService.getSubscription(request.params.id);
      if (!sub || sub.merchantId !== request.merchant!.id) {
        return reply.status(404).send({ error: "not found" });
      }
      return sub;
    },
  });

  // Cancel subscription
  app.post<{ Params: { id: string } }>("/v1/subscriptions/:id/cancel", {
    preHandler: [app.apiKeyAuth],
    handler: async (request, reply) => {
      const sub = await subService.getSubscription(request.params.id);
      if (!sub || sub.merchantId !== request.merchant!.id) {
        return reply.status(404).send({ error: "not found" });
      }
      const cancelled = await subService.cancelSubscription(sub.id);
      return cancelled;
    },
  });

  // List subscriptions
  app.get<{
    Querystring: { status?: string };
  }>("/v1/subscriptions", {
    preHandler: [app.apiKeyAuth],
    handler: async (request, reply) => {
      const subs = await subService.listSubscriptions(
        request.merchant!.id,
        request.query.status
      );
      return { data: subs, count: subs.length };
    },
  });
}
