import type { Chain, QuoteResponse } from "../types";

// Stablecoin addresses per chain
const STABLECOINS: Record<Chain, Record<string, string>> = {
  ethereum: {
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  },
  arbitrum: {
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  },
  bsc: {
    USDT: "0x55d398326f99059fF775485246999027B3197955",
    USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  },
  polygon: {
    USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  },
  optimism: {
    USDT: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
    USDC: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  },
};

// Depeg tracking: token → last known price ratio vs USD
const depegCache: Record<string, { ratio: number; updatedAt: number }> = {};
const DEPEG_THRESHOLD = 0.05; // 5%

export function isStablecoinDepegged(token: string): boolean {
  const entry = depegCache[token.toUpperCase()];
  if (!entry) return false;
  return Math.abs(1 - entry.ratio) > DEPEG_THRESHOLD;
}

export function updateDepegPrice(token: string, priceUsd: number) {
  depegCache[token.toUpperCase()] = {
    ratio: priceUsd,
    updatedAt: Date.now(),
  };
}

export function getAvailableStablecoins(chain: Chain): string[] {
  const coins = STABLECOINS[chain];
  if (!coins) return [];
  return Object.keys(coins).filter((t) => !isStablecoinDepegged(t));
}

export function getStablecoinAddress(
  chain: Chain,
  token: string
): string | null {
  return STABLECOINS[chain]?.[token.toUpperCase()] ?? null;
}

/**
 * Get a swap quote from DEX aggregator.
 * In production, call 1inch / ButterSwap API. This is a placeholder.
 */
export async function getSwapQuote(params: {
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  chain: Chain;
}): Promise<QuoteResponse> {
  // TODO: integrate real DEX aggregator (1inch, ButterSwap)
  // For now return a placeholder response
  const slippageBps = 50; // 0.5%
  const outputAmount = params.inputAmount; // placeholder 1:1
  const minOutput = (
    parseFloat(outputAmount) *
    (1 - slippageBps / 10000)
  ).toFixed(18);

  return {
    inputToken: params.inputToken,
    outputToken: params.outputToken,
    inputAmount: params.inputAmount,
    outputAmount,
    minOutputAmount: minOutput,
    priceImpact: "0.1",
    dexRouter: "0x0000000000000000000000000000000000000000", // placeholder
    dexCalldata: "0x", // placeholder
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
  };
}

/**
 * Periodically fetch stablecoin prices and update depeg cache.
 * In production, call CoinGecko / DeFiLlama.
 */
export async function refreshDepegPrices() {
  try {
    // TODO: fetch real prices from CoinGecko/DeFiLlama
    // For now assume pegged
    updateDepegPrice("USDT", 1.0);
    updateDepegPrice("USDC", 1.0);
  } catch (err) {
    console.error("[depeg] Failed to refresh prices:", err);
  }
}

// Start periodic check every 60 seconds
export function startDepegMonitor() {
  refreshDepegPrices();
  setInterval(refreshDepegPrices, 60_000);
}
