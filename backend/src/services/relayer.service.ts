import {
  createWalletClient,
  createPublicClient,
  http,
  encodeFunctionData,
  type Chain as ViemChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, arbitrum, bsc, polygon, optimism } from "viem/chains";
import { config } from "../config";
import type { Chain } from "../types";

const SUBSCRIPTION_MANAGER_ABI = [
  {
    name: "charge",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "subscriptionId", type: "uint256" }],
    outputs: [],
  },
] as const;

const chainMap: Record<Chain, ViemChain> = {
  ethereum: mainnet,
  arbitrum,
  bsc,
  polygon,
  optimism,
};

const rpcMap: Record<Chain, string> = {
  ethereum: config.rpc.ethereum,
  arbitrum: config.rpc.arbitrum,
  bsc: config.rpc.bsc,
  polygon: config.rpc.polygon,
  optimism: config.rpc.optimism,
};

// Relayer wallet: used to pay gas for subscription charges
const relayerKey = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;

/**
 * Call SubscriptionManager.charge(subscriptionId) via relayer.
 * Relayer pays gas so user doesn't need to.
 */
export async function chargeSubscription(
  chain: Chain,
  subscriptionManagerAddress: `0x${string}`,
  onChainId: number
): Promise<string | null> {
  if (!relayerKey) {
    console.warn("[relayer] No RELAYER_PRIVATE_KEY configured, skipping charge");
    return null;
  }

  const account = privateKeyToAccount(relayerKey);
  const viemChain = chainMap[chain];
  const rpcUrl = rpcMap[chain];

  const client = createWalletClient({
    account,
    chain: viemChain,
    transport: http(rpcUrl),
  });

  const data = encodeFunctionData({
    abi: SUBSCRIPTION_MANAGER_ABI,
    functionName: "charge",
    args: [BigInt(onChainId)],
  });

  try {
    const hash = await client.sendTransaction({
      to: subscriptionManagerAddress,
      data,
    });
    return hash;
  } catch (err: any) {
    console.error(`[relayer] charge failed for sub ${onChainId} on ${chain}:`, err.message);
    return null;
  }
}

/**
 * Check relayer balance on a given chain.
 */
export async function getRelayerBalance(chain: Chain): Promise<bigint> {
  if (!relayerKey) return 0n;

  const account = privateKeyToAccount(relayerKey);
  const client = createPublicClient({
    chain: chainMap[chain],
    transport: http(rpcMap[chain]),
  });

  return client.getBalance({ address: account.address });
}
