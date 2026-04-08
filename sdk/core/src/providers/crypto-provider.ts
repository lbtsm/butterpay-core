import {
  createPublicClient,
  http,
  encodeFunctionData,
  parseUnits,
  formatUnits,
  type Address,
  type PublicClient,
  maxUint256,
} from "viem";
import { ERC20_ABI, PAYMENT_RECEIVER_ABI } from "../abi/index.js";
import { defaultChainConfigs } from "../chains.js";
import type {
  PaymentProvider,
  PayParams,
  PayResult,
  WalletAdapter,
  ChainName,
  ChainConfig,
  BalanceInfo,
} from "../types.js";

export class CryptoPaymentProvider implements PaymentProvider {
  readonly method = "crypto" as const;

  private wallet: WalletAdapter;
  private chains: Record<string, ChainConfig>;
  private clients: Map<string, PublicClient> = new Map();

  constructor(
    wallet: WalletAdapter,
    chainOverrides?: Partial<Record<ChainName, Partial<ChainConfig>>>
  ) {
    this.wallet = wallet;

    // Merge defaults with overrides
    this.chains = { ...defaultChainConfigs };
    if (chainOverrides) {
      for (const [name, overrides] of Object.entries(chainOverrides)) {
        if (this.chains[name]) {
          this.chains[name] = { ...this.chains[name], ...overrides };
        }
      }
    }
  }

  private getClient(chain: ChainName): PublicClient {
    if (!this.clients.has(chain)) {
      const cfg = this.chains[chain];
      if (!cfg) throw new Error(`Unknown chain: ${chain}`);
      const client = createPublicClient({
        chain: cfg.viemChain,
        transport: http(cfg.rpcUrl),
      });
      this.clients.set(chain, client);
    }
    return this.clients.get(chain)!;
  }

  /** Scan all chains for token balances */
  async scanBalances(address: Address): Promise<BalanceInfo[]> {
    const results: BalanceInfo[] = [];

    const promises = Object.values(this.chains).flatMap((chainCfg) =>
      chainCfg.tokens.map(async (token) => {
        try {
          const client = this.getClient(chainCfg.name);
          const rawBalance = (await client.readContract({
            address: token.address,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [address],
          })) as bigint;

          if (rawBalance > 0n) {
            results.push({
              chain: chainCfg.name,
              token: token.symbol,
              balance: formatUnits(rawBalance, token.decimals),
              rawBalance,
            });
          }
        } catch {
          // Skip failed RPC calls
        }
      })
    );

    await Promise.allSettled(promises);
    return results.sort(
      (a, b) => parseFloat(b.balance) - parseFloat(a.balance)
    );
  }

  /** Check and approve token if needed */
  async ensureApproval(
    chain: ChainName,
    tokenAddress: Address,
    spender: Address,
    amount: bigint
  ): Promise<void> {
    const address = this.wallet.getAddress();
    if (!address) throw new Error("Wallet not connected");

    const client = this.getClient(chain);
    const allowance = (await client.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [address, spender],
    })) as bigint;

    if (allowance >= amount) return; // Already approved

    // Approve max
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, maxUint256],
    });

    await this.wallet.sendTransaction({
      to: tokenAddress,
      data,
      chainId: this.chains[chain].viemChain.id,
    });
  }

  /** Execute payment */
  async pay(params: PayParams): Promise<PayResult> {
    const address = this.wallet.getAddress();
    if (!address) throw new Error("Wallet not connected");

    const chainCfg = this.chains[params.chain];
    if (!chainCfg) throw new Error(`Unknown chain: ${params.chain}`);

    const tokenCfg = chainCfg.tokens.find((t) => t.symbol === params.token);
    if (!tokenCfg) throw new Error(`Unknown token: ${params.token}`);

    const amountWei = parseUnits(params.amount, tokenCfg.decimals);

    // 1. Ensure approval
    await this.ensureApproval(
      params.chain,
      tokenCfg.address,
      params.paymentReceiverAddress,
      amountWei
    );

    // 2. Build pay() call
    const data = encodeFunctionData({
      abi: PAYMENT_RECEIVER_ABI,
      functionName: "pay",
      args: [
        {
          invoiceId: params.invoiceIdBytes32,
          token: tokenCfg.address,
          amount: amountWei,
          merchant: params.merchantAddress,
          referrer: params.referrer || ("0x0000000000000000000000000000000000000000" as Address),
          serviceFeeBps: params.serviceFeeBps,
          referrerFeeBps: params.referrerFeeBps || 0,
          deadline: BigInt(params.deadline),
        },
      ],
    });

    // 3. Send transaction
    const txHash = await this.wallet.sendTransaction({
      to: params.paymentReceiverAddress,
      data,
      chainId: chainCfg.viemChain.id,
    });

    return {
      txHash,
      chain: params.chain,
      status: "submitted",
    };
  }
}
