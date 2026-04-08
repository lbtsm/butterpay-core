import { FastifyInstance } from "fastify";
import * as invoiceService from "../services/invoice.service";
import { trackTransaction } from "../services/tx-tracker.service";
import type { Chain, InvoiceStatus } from "../types";

export async function invoiceRoutes(app: FastifyInstance) {
  // Create invoice (v2.1: USD-denominated, token/chain resolved at payment time)
  app.post<{
    Body: {
      amountUsd: string;
      chain?: Chain;
      description?: string;
      merchantOrderId?: string;
      metadata?: Record<string, unknown>;
      redirectUrl?: string;
      webhookUrl?: string;
    };
  }>("/v1/invoices", {
    preHandler: [app.apiKeyAuth],
    handler: async (request, reply) => {
      const { amountUsd } = request.body;

      if (!amountUsd) {
        return reply.status(400).send({ error: "amountUsd is required" });
      }
      if (parseFloat(amountUsd) <= 0) {
        return reply.status(400).send({ error: "amountUsd must be positive" });
      }

      const invoice = await invoiceService.createInvoice({
        merchantId: request.merchant!.id,
        ...request.body,
      });

      return reply.status(201).send(invoice);
    },
  });

  // Get invoice (public — SDK needs to fetch without API key)
  app.get<{ Params: { id: string } }>("/v1/invoices/:id", {
    handler: async (request, reply) => {
      const invoice = await invoiceService.getInvoice(request.params.id);
      if (!invoice) {
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
      chain: Chain;
      token: string;
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

      const { txHash, payerAddress, toAddress, chain, token } = request.body;
      if (!txHash || !payerAddress || !chain || !token) {
        return reply
          .status(400)
          .send({ error: "txHash, payerAddress, chain, and token are required" });
      }

      // Update invoice with actual chain/token chosen by user
      await invoiceService.updateInvoiceStatus(invoice.id, "initiated", {
        txHash,
        payerAddress,
        chain,
        token,
      });

      const txId = await trackTransaction(
        invoice.id,
        chain,
        txHash,
        payerAddress,
        toAddress,
        token,
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
      const { status, chain, token, from, to, limit, offset } = request.query;
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
      return invoiceService.getTransactionsSummary(
        request.merchant!.id,
        from ? new Date(from) : undefined,
        to ? new Date(to) : undefined
      );
    },
  });
}
