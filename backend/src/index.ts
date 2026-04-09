import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config";
import { apiKeyAuth } from "./middleware/auth";
import { merchantRoutes } from "./routes/merchants";
import { invoiceRoutes } from "./routes/invoices";
import { quoteRoutes } from "./routes/quotes";
import { keystoreRoutes } from "./routes/keystores";
import { subscriptionRoutes } from "./routes/subscriptions";
import { fiatRoutes } from "./routes/fiat";
import { referrerRoutes } from "./routes/referrers";
import { startPollingScheduler } from "./queues";
import { startDepegMonitor } from "./services/quote.service";

declare module "fastify" {
  interface FastifyInstance {
    apiKeyAuth: typeof apiKeyAuth;
  }
}

async function main() {
  const app = Fastify({ logger: true });

  // Plugins
  await app.register(cors, { origin: true });

  // Decorate with auth
  app.decorate("apiKeyAuth", apiKeyAuth);

  // Health check
  app.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  // Phase 1 Routes
  await app.register(merchantRoutes);
  await app.register(invoiceRoutes);
  await app.register(quoteRoutes);

  // Phase 2 Routes
  await app.register(keystoreRoutes);
  await app.register(subscriptionRoutes);

  // Phase 3 Routes
  await app.register(fiatRoutes);
  await app.register(referrerRoutes);

  // Start background jobs
  startPollingScheduler();
  startDepegMonitor();

  // Start server
  await app.listen({ port: config.port, host: config.host });
  console.log(`ButterPay API running on http://${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
