import { FastifyRequest, FastifyReply } from "fastify";
import { getMerchantByApiKey } from "../services/merchant.service";

declare module "fastify" {
  interface FastifyRequest {
    merchant?: {
      id: string;
      name: string;
      serviceFeeBps: number;
      receivingAddresses: Record<string, string>;
    };
  }
}

export async function apiKeyAuth(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const apiKey = request.headers["x-api-key"] as string;

  if (!apiKey) {
    return reply.status(401).send({ error: "Missing API key" });
  }

  const merchant = await getMerchantByApiKey(apiKey);

  if (!merchant || !merchant.active) {
    return reply.status(401).send({ error: "Invalid API key" });
  }

  request.merchant = {
    id: merchant.id,
    name: merchant.name,
    serviceFeeBps: merchant.serviceFeeBps,
    receivingAddresses: merchant.receivingAddresses as Record<string, string>,
  };
}
