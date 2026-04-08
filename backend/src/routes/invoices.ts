import { FastifyInstance } from "fastify";
import * as invoiceService from "../services/invoice.service";
import { trackTransaction } from "../services/tx-tracker.service";
import type { Chain, Token, InvoiceStatus } from "../types";

export async function invoiceRoutes(app: FastifyInstance) {
  // Create invoice
  app.post<{
    Body: {
      amount: string;
      token: Token;
      chain: Chain;
      description?: string;
      merchantOrderId?: string;
      metadata?: Record<string, unknown>;
      redirectUrl?: string;
      webhookUrl?: string;
    };
  }>("/v1/invoices", {
    preHandler: [app.apiKeyAuth],
    handler: async (request, reply) => {
      const { amount, token, chain } = request.body;

      if (!amount || !token || !chain) {
        return reply
          .status(400)
          .send({ error: "amount, token, and chain are required" });
      }

      if (parseFloat(amount) <= 0) {
        return reply.status(400).send({ error: "amount must be positive" });
      }

      const invoice = await invoiceService.createInvoice({
        merchantId: request.merchant!.id,
        ...request.body,
      });

      return reply.status(201).send(invoice);
    },
  });

  // Get invoice
  app.get<{ Params: { id: string } }>("/v1/invoices/:id", {
    preHandler: [app.apiKeyAuth],
    handler: async (request, reply) => {
      const invoice = await invoiceService.getInvoice(request.params.id);
      if (!invoice || invoice.merchantId !== request.merchant!.id) {
        return reply.status(404).send({ error: "not found" });
      }
      return invoice;
    },
  });

  // Submit transaction for tracking (called by SDK after user signs tx)
  app.post<{
    Params: { id: string };
    Body: {
      txHash: string;
      payerAddress: string;
      toAddress: string;
    };
  }>("/v1/invoices/:id/tx", {
    handler: async (request, reply) => {
      const invoice = await invoiceService.getInvoice(request.params.id);
      if (!invoice) {
        return reply.status(404).send({ error: "invoice not found" });
      }
      if (invoice.status !== "created") {
        return reply
          .status(400)
          .send({ error: `invoice is ${invoice.status}, expected created` });
      }

      const { txHash, payerAddress, toAddress } = request.body;
      if (!txHash || !payerAddress) {
        return reply
          .status(400)
          .send({ error: "txHash and payerAddress are required" });
      }

      const txId = await trackTransaction(
        invoice.id,
        invoice.chain as Chain,
        txHash,
        payerAddress,
        toAddress,
        invoice.token,
        invoice.amount
      );

      return { txId, status: "tracking" };
    },
  });

  // List transactions (reconciliation)
  app.get<{
    Querystring: {
      status?: InvoiceStatus;
      chain?: string;
      token?: string;
      from?: string;
      to?: string;
      limit?: string;
      offset?: string;
    };
  }>("/v1/transactions", {
    preHandler: [app.apiKeyAuth],
    handler: async (request, reply) => {
      const { status, chain, token, from, to, limit, offset } =
        request.query;

      const invoices = await invoiceService.listInvoices({
        merchantId: request.merchant!.id,
        status: status as InvoiceStatus,
        chain,
        token,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        limit: limit ? parseInt(limit) : 50,
        offset: offset ? parseInt(offset) : 0,
      });

      return { data: invoices, count: invoices.length };
    },
  });

  // Transaction summary
  app.get<{
    Querystring: { from?: string; to?: string };
  }>("/v1/transactions/summary", {
    preHandler: [app.apiKeyAuth],
    handler: async (request, reply) => {
      const { from, to } = request.query;
      const summary = await invoiceService.getTransactionsSummary(
        request.merchant!.id,
        from ? new Date(from) : undefined,
        to ? new Date(to) : undefined
      );
      return summary;
    },
  });
}
