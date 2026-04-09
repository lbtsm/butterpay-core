import { createPublicClient, http, formatUnits } from "viem";
import { mainnet, arbitrum, bsc, polygon, optimism } from "viem/chains";
import { config } from "../config";
import type { Chain } from "../types";

const ERC20_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const CHAINS: { name: Chain; chain: any; rpc: string }[] = [
  { name: "ethereum", chain: mainnet, rpc: config.rpc.ethereum },
  { name: "arbitrum", chain: arbitrum, rpc: config.rpc.arbitrum },
  { name: "bsc", chain: bsc, rpc: config.rpc.bsc },
  { name: "polygon", chain: polygon, rpc: config.rpc.polygon },
  { name: "optimism", chain: optimism, rpc: config.rpc.optimism },
];

const TOKENS: Record<Chain, { symbol: string; address: `0x${string}`; decimals: number }[]> = {
  ethereum: [
    { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
  ],
  arbitrum: [
    { symbol: "USDT", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
    { symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
  ],
  bsc: [
    { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
    { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
  ],
  polygon: [
    { symbol: "USDT", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
    { symbol: "USDC", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
  ],
  optimism: [
    { symbol: "USDT", address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6 },
    { symbol: "USDC", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
  ],
};

export interface BalanceEntry {
  chain: Chain;
  token: string;
  address: string;
  balance: string;
}

/**
 * Fetch merchant's stablecoin balances across all chains.
 */
export async function getMerchantBalances(
  receivingAddresses: Record<string, string>
): Promise<BalanceEntry[]> {
  const results: BalanceEntry[] = [];

  const promises = CHAINS.flatMap((chainCfg) => {
    const addr = receivingAddresses[chainCfg.name];
    if (!addr) return [];

    const client = createPublicClient({
      chain: chainCfg.chain,
      transport: http(chainCfg.rpc),
    });

    return TOKENS[chainCfg.name].map(async (token) => {
      try {
        const raw = (await client.readContract({
          address: token.address,
          abi: ERC20_BALANCE_ABI,
          functionName: "balanceOf",
          args: [addr as `0x${string}`],
        })) as bigint;

        results.push({
          chain: chainCfg.name,
          token: token.symbol,
          address: addr,
          balance: formatUnits(raw, token.decimals),
        });
      } catch {
        results.push({
          chain: chainCfg.name,
          token: token.symbol,
          address: addr,
          balance: "0",
        });
      }
    });
  });

  await Promise.allSettled(promises);
  return results;
}
