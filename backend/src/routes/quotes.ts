import { FastifyInstance } from "fastify";
import {
  getSwapQuote,
  getAvailableStablecoins,
  getStablecoinAddress,
} from "../services/quote.service";
import type { Chain } from "../types";

export async function quoteRoutes(app: FastifyInstance) {
  // Get swap quote for non-stablecoin payment
  app.get<{
    Querystring: {
      inputToken: string;
      outputToken?: string;
      inputAmount: string;
      chain: Chain;
    };
  }>("/v1/quotes", {
    handler: async (request, reply) => {
      const { inputToken, outputToken, inputAmount, chain } = request.query;

      if (!inputToken || !inputAmount || !chain) {
        return reply
          .status(400)
          .send({ error: "inputToken, inputAmount, and chain are required" });
      }

      const target = outputToken || "USDT";
      const targetAddress = getStablecoinAddress(chain, target);
      if (!targetAddress) {
        return reply
          .status(400)
          .send({ error: `${target} not available on ${chain}` });
      }

      const quote = await getSwapQuote({
        inputToken,
        outputToken: targetAddress,
        inputAmount,
        chain,
      });

      return quote;
    },
  });

  // Get available stablecoins for a chain (filters out depegged ones)
  app.get<{
    Params: { chain: Chain };
  }>("/v1/chains/:chain/stablecoins", {
    handler: async (request, reply) => {
      const { chain } = request.params;
      const coins = getAvailableStablecoins(chain);
      return {
        chain,
        stablecoins: coins.map((symbol) => ({
          symbol,
          address: getStablecoinAddress(chain, symbol),
        })),
      };
    },
  });
}
