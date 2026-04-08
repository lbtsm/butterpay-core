import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config";
import { apiKeyAuth } from "./middleware/auth";
import { merchantRoutes } from "./routes/merchants";
import { invoiceRoutes } from "./routes/invoices";
import { startPollingScheduler } from "./queues";

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

  // Routes
  await app.register(merchantRoutes);
  await app.register(invoiceRoutes);

  // Start background jobs
  startPollingScheduler();

  // Start server
  await app.listen({ port: config.port, host: config.host });
  console.log(`ButterPay API running on http://${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
