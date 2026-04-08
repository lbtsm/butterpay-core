import { Pool } from "pg";
import { config } from "../config";

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS merchants (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    api_key VARCHAR(64) NOT NULL,
    api_secret VARCHAR(128) NOT NULL,
    webhook_url TEXT,
    webhook_secret VARCHAR(128),
    receiving_addresses JSONB DEFAULT '{}',
    service_fee_bps INTEGER NOT NULL DEFAULT 80,
    referrer_id VARCHAR(32),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS merchants_api_key_idx ON merchants(api_key)`,

  `CREATE TABLE IF NOT EXISTS invoices (
    id VARCHAR(32) PRIMARY KEY,
    merchant_id VARCHAR(32) NOT NULL REFERENCES merchants(id),
    merchant_order_id VARCHAR(255),
    amount NUMERIC(36, 18) NOT NULL,
    token VARCHAR(10) NOT NULL,
    chain VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'created',
    payment_method VARCHAR(10),
    payer_address VARCHAR(66),
    tx_hash VARCHAR(66),
    service_fee NUMERIC(36, 18),
    merchant_received NUMERIC(36, 18),
    referrer_fee NUMERIC(36, 18),
    description TEXT,
    metadata JSONB,
    redirect_url TEXT,
    webhook_url TEXT,
    expires_at TIMESTAMP,
    confirmed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS invoices_merchant_id_idx ON invoices(merchant_id)`,
  `CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices(status)`,
  `CREATE INDEX IF NOT EXISTS invoices_tx_hash_idx ON invoices(tx_hash)`,

  `CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(32) PRIMARY KEY,
    invoice_id VARCHAR(32) NOT NULL REFERENCES invoices(id),
    chain VARCHAR(20) NOT NULL,
    tx_hash VARCHAR(66) NOT NULL,
    block_number INTEGER,
    from_address VARCHAR(66) NOT NULL,
    to_address VARCHAR(66) NOT NULL,
    token VARCHAR(10) NOT NULL,
    amount NUMERIC(36, 18) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    confirmations INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    confirmed_at TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS transactions_tx_hash_chain_idx ON transactions(tx_hash, chain)`,
  `CREATE INDEX IF NOT EXISTS transactions_invoice_id_idx ON transactions(invoice_id)`,

  `CREATE TABLE IF NOT EXISTS webhooks (
    id VARCHAR(32) PRIMARY KEY,
    merchant_id VARCHAR(32) NOT NULL REFERENCES merchants(id),
    url TEXT NOT NULL,
    secret VARCHAR(128) NOT NULL,
    events JSONB DEFAULT '[]',
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS webhook_logs (
    id VARCHAR(32) PRIMARY KEY,
    webhook_id VARCHAR(32),
    invoice_id VARCHAR(32),
    event VARCHAR(50) NOT NULL,
    url TEXT NOT NULL,
    payload JSONB,
    status_code INTEGER,
    response TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMP,
    success BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS subscriptions (
    id VARCHAR(32) PRIMARY KEY,
    merchant_id VARCHAR(32) NOT NULL REFERENCES merchants(id),
    subscriber_address VARCHAR(66) NOT NULL,
    chain VARCHAR(20) NOT NULL,
    token VARCHAR(10) NOT NULL,
    amount NUMERIC(36, 18) NOT NULL,
    interval_seconds INTEGER NOT NULL,
    on_chain_id INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    next_charge_at TIMESTAMP,
    last_charged_at TIMESTAMP,
    expires_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS referrers (
    id VARCHAR(32) PRIMARY KEY,
    wallet_address VARCHAR(66) NOT NULL,
    code VARCHAR(20) NOT NULL,
    fee_bps INTEGER NOT NULL DEFAULT 20,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS referrers_code_idx ON referrers(code)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS referrers_wallet_idx ON referrers(wallet_address)`,

  `CREATE TABLE IF NOT EXISTS keystores (
    id VARCHAR(32) PRIMARY KEY,
    telegram_user_id VARCHAR(64) NOT NULL,
    encrypted_keystore TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,
];

async function migrate() {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const client = await pool.connect();

  try {
    console.log("Running migrations...");
    for (const sql of MIGRATIONS) {
      await client.query(sql);
    }
    console.log("Migrations complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
