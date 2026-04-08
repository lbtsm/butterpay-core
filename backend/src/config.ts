import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3000"),
  host: process.env.HOST || "0.0.0.0",
  databaseUrl:
    process.env.DATABASE_URL ||
    "postgresql://butterpay:butterpay@localhost:5432/butterpay",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  webhookSecret: process.env.WEBHOOK_SECRET || "dev-secret",
  rpc: {
    arbitrum: process.env.RPC_ARBITRUM || "https://arb1.arbitrum.io/rpc",
    bsc: process.env.RPC_BSC || "https://bsc-rpc.publicnode.com",
    polygon: process.env.RPC_POLYGON || "https://polygon-bor-rpc.publicnode.com",
    optimism: process.env.RPC_OPTIMISM || "https://mainnet.optimism.io",
    ethereum: process.env.RPC_ETHEREUM || "https://ethereum-rpc.publicnode.com",
  },
} as const;
