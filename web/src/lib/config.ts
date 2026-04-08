export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export const SUPPORTED_CHAINS = [
  { name: "arbitrum", label: "Arbitrum", chainId: 42161 },
  { name: "bsc", label: "BSC", chainId: 56 },
  { name: "polygon", label: "Polygon", chainId: 137 },
  { name: "optimism", label: "Optimism", chainId: 10 },
  { name: "ethereum", label: "Ethereum", chainId: 1 },
] as const;

export const STABLECOINS: Record<string, Record<string, { address: `0x${string}`; decimals: number }>> = {
  arbitrum: {
    USDT: { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
    USDC: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
  },
  bsc: {
    USDT: { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
    USDC: { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
  },
  polygon: {
    USDT: { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
    USDC: { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
  },
  optimism: {
    USDT: { address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6 },
    USDC: { address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
  },
  ethereum: {
    USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
  },
};
