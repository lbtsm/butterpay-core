import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config";
import { pollTransaction } from "../services/tx-tracker.service";
import { sendWebhook } from "../services/webhook.service";
import { db, schema } from "../db";
import { eq, and, isNotNull, lte } from "drizzle-orm";

const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

// ========================= Tx Tracking Queue =========================

export const txTrackingQueue = new Queue("tx-tracking", { connection });

const txWorker = new Worker(
  "tx-tracking",
  async (job) => {
    await pollTransaction(job.data.txId);
  },
  {
    connection,
    concurrency: 10,
  }
);

txWorker.on("failed", (job, err) => {
  console.error(`[tx-tracking] Job ${job?.id} failed:`, err.message);
});

// ========================= Webhook Retry Queue =========================

export const webhookRetryQueue = new Queue("webhook-retry", { connection });

const RETRY_DELAYS = [10_000, 60_000, 300_000]; // 10s, 60s, 5min

const webhookRetryWorker = new Worker(
  "webhook-retry",
  async (job) => {
    const { logId } = job.data;
    const [log] = await db
      .select()
      .from(schema.webhookLogs)
      .where(eq(schema.webhookLogs.id, logId))
      .limit(1);

    if (!log || log.success) return;

    const payload = log.payload as any;
    const body = JSON.stringify(payload);

    try {
      const res = await fetch(log.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(10000),
      });

      await db
        .update(schema.webhookLogs)
        .set({
          attempts: log.attempts + 1,
          statusCode: res.status,
          success: res.ok,
          nextRetryAt: res.ok
            ? null
            : log.attempts < RETRY_DELAYS.length
              ? new Date(Date.now() + RETRY_DELAYS[log.attempts])
              : null,
        })
        .where(eq(schema.webhookLogs.id, logId));
    } catch (err: any) {
      await db
        .update(schema.webhookLogs)
        .set({
          attempts: log.attempts + 1,
          response: err.message,
          nextRetryAt:
            log.attempts < RETRY_DELAYS.length
              ? new Date(Date.now() + RETRY_DELAYS[log.attempts])
              : null,
        })
        .where(eq(schema.webhookLogs.id, logId));
    }
  },
  { connection, concurrency: 5 }
);

webhookRetryWorker.on("failed", (job, err) => {
  console.error(`[webhook-retry] Job ${job?.id} failed:`, err.message);
});

// ========================= Scheduled Polling =========================

export async function startPollingScheduler() {
  // Poll pending transactions every 15 seconds
  setInterval(async () => {
    try {
      const pendingTxs = await db
        .select()
        .from(schema.transactions)
        .where(eq(schema.transactions.status, "pending"))
        .limit(100);

      for (const tx of pendingTxs) {
        await txTrackingQueue.add(
          "poll",
          { txId: tx.id },
          { jobId: `poll-${tx.id}`, removeOnComplete: true }
        );
      }
    } catch (err) {
      console.error("[polling] Error:", err);
    }
  }, 15_000);

  // Retry failed webhooks every 30 seconds
  setInterval(async () => {
    try {
      const failedLogs = await db
        .select()
        .from(schema.webhookLogs)
        .where(
          and(
            eq(schema.webhookLogs.success, false),
            isNotNull(schema.webhookLogs.nextRetryAt),
            lte(schema.webhookLogs.nextRetryAt, new Date())
          )
        )
        .limit(50);

      for (const log of failedLogs) {
        await webhookRetryQueue.add(
          "retry",
          { logId: log.id },
          { jobId: `retry-${log.id}`, removeOnComplete: true }
        );
      }
    } catch (err) {
      console.error("[webhook-retry-scheduler] Error:", err);
    }
  }, 30_000);
}
