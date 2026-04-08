import {
  pgTable,
  text,
  varchar,
  timestamp,
  numeric,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ========================= Merchants =========================

export const merchants = pgTable(
  "merchants",
  {
    id: varchar("id", { length: 32 }).primaryKey(), // e.g. "mer_xxxx"
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }),
    apiKey: varchar("api_key", { length: 64 }).notNull(),
    apiSecret: varchar("api_secret", { length: 128 }).notNull(),
    webhookUrl: text("webhook_url"),
    webhookSecret: varchar("webhook_secret", { length: 128 }),

    // Receiving addresses per chain (JSON: { "ethereum": "0x...", "bsc": "0x..." })
    receivingAddresses: jsonb("receiving_addresses")
      .$type<Record<string, string>>()
      .default({}),

    // Default service fee in basis points
    serviceFeeBps: integer("service_fee_bps").notNull().default(80),

    // Referrer
    referrerId: varchar("referrer_id", { length: 32 }),

    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("merchants_api_key_idx").on(table.apiKey),
  ]
);

// ========================= Invoices =========================

export const invoices = pgTable(
  "invoices",
  {
    id: varchar("id", { length: 32 }).primaryKey(), // e.g. "inv_xxxx"
    merchantId: varchar("merchant_id", { length: 32 })
      .notNull()
      .references(() => merchants.id),
    merchantOrderId: varchar("merchant_order_id", { length: 255 }),

    amount: numeric("amount", { precision: 36, scale: 18 }).notNull(),
    token: varchar("token", { length: 10 }).notNull(), // USDT, USDC
    chain: varchar("chain", { length: 20 }).notNull(),

    status: varchar("status", { length: 20 }).notNull().default("created"),
    paymentMethod: varchar("payment_method", { length: 10 }), // crypto, fiat

    // Payer info (filled after payment initiated)
    payerAddress: varchar("payer_address", { length: 66 }),
    txHash: varchar("tx_hash", { length: 66 }),

    // Fee breakdown
    serviceFee: numeric("service_fee", { precision: 36, scale: 18 }),
    merchantReceived: numeric("merchant_received", { precision: 36, scale: 18 }),
    referrerFee: numeric("referrer_fee", { precision: 36, scale: 18 }),

    description: text("description"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    redirectUrl: text("redirect_url"),
    webhookUrl: text("webhook_url"), // per-invoice override

    expiresAt: timestamp("expires_at"),
    confirmedAt: timestamp("confirmed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("invoices_merchant_id_idx").on(table.merchantId),
    index("invoices_status_idx").on(table.status),
    index("invoices_tx_hash_idx").on(table.txHash),
    index("invoices_merchant_order_id_idx").on(
      table.merchantId,
      table.merchantOrderId
    ),
  ]
);

// ========================= Transactions =========================

export const transactions = pgTable(
  "transactions",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    invoiceId: varchar("invoice_id", { length: 32 })
      .notNull()
      .references(() => invoices.id),

    chain: varchar("chain", { length: 20 }).notNull(),
    txHash: varchar("tx_hash", { length: 66 }).notNull(),
    blockNumber: integer("block_number"),
    fromAddress: varchar("from_address", { length: 66 }).notNull(),
    toAddress: varchar("to_address", { length: 66 }).notNull(),
    token: varchar("token", { length: 10 }).notNull(),
    amount: numeric("amount", { precision: 36, scale: 18 }).notNull(),

    status: varchar("status", { length: 20 }).notNull().default("pending"),
    confirmations: integer("confirmations").default(0),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    confirmedAt: timestamp("confirmed_at"),
  },
  (table) => [
    uniqueIndex("transactions_tx_hash_chain_idx").on(table.txHash, table.chain),
    index("transactions_invoice_id_idx").on(table.invoiceId),
  ]
);

// ========================= Webhooks Config =========================

export const webhooks = pgTable("webhooks", {
  id: varchar("id", { length: 32 }).primaryKey(),
  merchantId: varchar("merchant_id", { length: 32 })
    .notNull()
    .references(() => merchants.id),
  url: text("url").notNull(),
  secret: varchar("secret", { length: 128 }).notNull(),
  events: jsonb("events").$type<string[]>().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ========================= Webhook Logs =========================

export const webhookLogs = pgTable(
  "webhook_logs",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    webhookId: varchar("webhook_id", { length: 32 }),
    invoiceId: varchar("invoice_id", { length: 32 }),
    event: varchar("event", { length: 50 }).notNull(),
    url: text("url").notNull(),
    payload: jsonb("payload"),
    statusCode: integer("status_code"),
    response: text("response"),
    attempts: integer("attempts").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at"),
    success: boolean("success").default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("webhook_logs_invoice_id_idx").on(table.invoiceId),
  ]
);

// ========================= Subscriptions =========================

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    merchantId: varchar("merchant_id", { length: 32 })
      .notNull()
      .references(() => merchants.id),
    subscriberAddress: varchar("subscriber_address", { length: 66 }).notNull(),
    chain: varchar("chain", { length: 20 }).notNull(),
    token: varchar("token", { length: 10 }).notNull(),
    amount: numeric("amount", { precision: 36, scale: 18 }).notNull(),
    interval: integer("interval_seconds").notNull(), // in seconds
    onChainId: integer("on_chain_id"), // subscription ID from contract

    status: varchar("status", { length: 20 }).notNull().default("active"),
    nextChargeAt: timestamp("next_charge_at"),
    lastChargedAt: timestamp("last_charged_at"),
    expiresAt: timestamp("expires_at"),
    cancelledAt: timestamp("cancelled_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("subscriptions_merchant_id_idx").on(table.merchantId),
    index("subscriptions_status_idx").on(table.status),
    index("subscriptions_next_charge_idx").on(table.nextChargeAt),
  ]
);

// ========================= Referrers =========================

export const referrers = pgTable(
  "referrers",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    walletAddress: varchar("wallet_address", { length: 66 }).notNull(),
    code: varchar("code", { length: 20 }).notNull(),
    feeBps: integer("fee_bps").notNull().default(20), // default 0.2%
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("referrers_code_idx").on(table.code),
    uniqueIndex("referrers_wallet_idx").on(table.walletAddress),
  ]
);

// ========================= Keystores (TG users) =========================

export const keystores = pgTable("keystores", {
  id: varchar("id", { length: 32 }).primaryKey(),
  telegramUserId: varchar("telegram_user_id", { length: 64 }).notNull(),
  encryptedKeystore: text("encrypted_keystore").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
