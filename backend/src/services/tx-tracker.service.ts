import { createPublicClient, http, type Chain as ViemChain } from "viem";
import { mainnet, arbitrum, bsc, polygon, optimism } from "viem/chains";
import { config } from "../config";
import { db, schema } from "../db";
import { eq } from "drizzle-orm";
import { genId } from "../utils";
import { sendWebhook } from "./webhook.service";
import type { Chain, WebhookPayload } from "../types";

const REQUIRED_CONFIRMATIONS: Record<Chain, number> = {
  ethereum: 12,
  arbitrum: 20,
  bsc: 15,
  polygon: 128,
  optimism: 20,
};

const chainConfigs: Record<Chain, { chain: ViemChain; rpc: string }> = {
  ethereum: { chain: mainnet, rpc: config.rpc.ethereum },
  arbitrum: { chain: arbitrum, rpc: config.rpc.arbitrum },
  bsc: { chain: bsc, rpc: config.rpc.bsc },
  polygon: { chain: polygon, rpc: config.rpc.polygon },
  optimism: { chain: optimism, rpc: config.rpc.optimism },
};

function getClient(chain: Chain) {
  const cfg = chainConfigs[chain];
  return createPublicClient({
    chain: cfg.chain,
    transport: http(cfg.rpc),
  });
}

export async function trackTransaction(
  invoiceId: string,
  chain: Chain,
  txHash: string,
  fromAddress: string,
  toAddress: string,
  token: string,
  amount: string
) {
  const txId = genId("tx");

  await db.insert(schema.transactions).values({
    id: txId,
    invoiceId,
    chain,
    txHash,
    fromAddress,
    toAddress,
    token,
    amount,
    status: "pending",
  });

  // Update invoice status to initiated
  const [invoice] = await db
    .update(schema.invoices)
    .set({
      status: "initiated",
      txHash,
      payerAddress: fromAddress,
      paymentMethod: "crypto",
      updatedAt: new Date(),
    })
    .where(eq(schema.invoices.id, invoiceId))
    .returning();

  // Send initiated webhook
  if (invoice) {
    const payload: WebhookPayload = {
      event: "payment.initiated",
      invoiceId,
      merchantOrderId: invoice.merchantOrderId || undefined,
      txHash,
      chain,
      timestamp: new Date().toISOString(),
    };
    await sendWebhook(invoiceId, payload);
  }

  return txId;
}

export async function pollTransaction(txId: string) {
  const [tx] = await db
    .select()
    .from(schema.transactions)
    .where(eq(schema.transactions.id, txId))
    .limit(1);

  if (!tx || tx.status === "confirmed") return;

  const chain = tx.chain as Chain;
  const client = getClient(chain);
  const required = REQUIRED_CONFIRMATIONS[chain];

  try {
    const receipt = await client.getTransactionReceipt({
      hash: tx.txHash as `0x${string}`,
    });

    if (!receipt) return;

    const currentBlock = await client.getBlockNumber();
    const confirmations = Number(currentBlock - receipt.blockNumber);

    if (receipt.status === "reverted") {
      // Transaction failed
      await db
        .update(schema.transactions)
        .set({ status: "failed" })
        .where(eq(schema.transactions.id, txId));

      await db
        .update(schema.invoices)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(schema.invoices.id, tx.invoiceId));

      const [invoice] = await db
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.id, tx.invoiceId))
        .limit(1);

      if (invoice) {
        await sendWebhook(tx.invoiceId, {
          event: "payment.failed",
          invoiceId: tx.invoiceId,
          merchantOrderId: invoice.merchantOrderId || undefined,
          txHash: tx.txHash,
          chain,
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

    // Update confirmations
    await db
      .update(schema.transactions)
      .set({
        blockNumber: Number(receipt.blockNumber),
        confirmations,
      })
      .where(eq(schema.transactions.id, txId));

    // Check if enough confirmations
    if (confirmations >= required) {
      const now = new Date();

      await db
        .update(schema.transactions)
        .set({ status: "confirmed", confirmedAt: now })
        .where(eq(schema.transactions.id, txId));

      const [invoice] = await db
        .update(schema.invoices)
        .set({ status: "confirmed", confirmedAt: now, updatedAt: now })
        .where(eq(schema.invoices.id, tx.invoiceId))
        .returning();

      if (invoice) {
        await sendWebhook(tx.invoiceId, {
          event: "payment.confirmed",
          invoiceId: tx.invoiceId,
          merchantOrderId: invoice.merchantOrderId || undefined,
          amountUsd: invoice.amount,
          tokenAmount: invoice.amount,
          serviceFee: invoice.serviceFee || undefined,
          merchantReceived: invoice.merchantReceived || undefined,
          paymentMethod: "crypto",
          chain,
          token: invoice.token as any,
          txHash: tx.txHash,
          timestamp: now.toISOString(),
        });
      }
    }
  } catch {
    // RPC error, will retry on next poll
  }
}
