"use client";

import { useState, useEffect, useCallback } from "react";
import {
  createPublicClient,
  http,
  formatUnits,
  parseUnits,
  encodeFunctionData,
  keccak256,
  toHex,
  maxUint256,
} from "viem";
import { mainnet, arbitrum, bsc, polygon, optimism } from "viem/chains";
import type { Invoice } from "@/lib/api";
import { submitTransaction, pollInvoiceStatus } from "@/lib/api";
import { SUPPORTED_CHAINS, STABLECOINS } from "@/lib/config";
import { ERC20_ABI, PAYMENT_ROUTER_ABI } from "@/lib/abi";

const viemChains: Record<string, any> = {
  ethereum: mainnet, arbitrum, bsc, polygon, optimism,
};

// Placeholder — will be set after deployment
const PAYMENT_ROUTER: Record<string, `0x${string}`> = {
  ethereum: "0x0000000000000000000000000000000000000000",
  arbitrum: "0x0000000000000000000000000000000000000000",
  bsc: "0x0000000000000000000000000000000000000000",
  polygon: "0x0000000000000000000000000000000000000000",
  optimism: "0x0000000000000000000000000000000000000000",
};

type Step = "connect" | "select" | "paying" | "confirming" | "success" | "failed";

interface Balance {
  chain: string;
  token: string;
  balance: string;
  address: `0x${string}`;
  decimals: number;
}

export default function PaymentFlow({ invoice }: { invoice: Invoice }) {
  const [step, setStep] = useState<Step>("connect");
  const [provider, setProvider] = useState<any>(null);
  const [account, setAccount] = useState<string>("");
  const [balances, setBalances] = useState<Balance[]>([]);
  const [selectedChain, setSelectedChain] = useState("");
  const [selectedToken, setSelectedToken] = useState("");
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");

  const isExpired = invoice.expiresAt && new Date(invoice.expiresAt) < new Date();

  // Connect wallet via window.ethereum (MetaMask / injected)
  const connectWallet = useCallback(async () => {
    try {
      const eth = (window as any).ethereum;
      if (!eth) {
        setError("No wallet found. Please install MetaMask or use WalletConnect.");
        return;
      }
      const accounts = await eth.request({ method: "eth_requestAccounts" });
      setProvider(eth);
      setAccount(accounts[0]);
      setStep("select");
      setError("");
    } catch (err: any) {
      setError(err.message || "Failed to connect wallet");
    }
  }, []);

  // Scan balances across chains
  useEffect(() => {
    if (!account) return;

    async function scan() {
      const results: Balance[] = [];
      const promises = SUPPORTED_CHAINS.flatMap((chain) => {
        const tokens = STABLECOINS[chain.name];
        if (!tokens) return [];
        return Object.entries(tokens).map(async ([symbol, cfg]) => {
          try {
            const client = createPublicClient({
              chain: viemChains[chain.name],
              transport: http(),
            });
            const raw = (await client.readContract({
              address: cfg.address,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [account as `0x${string}`],
            })) as bigint;
            if (raw > 0n) {
              results.push({
                chain: chain.name,
                token: symbol,
                balance: formatUnits(raw, cfg.decimals),
                address: cfg.address,
                decimals: cfg.decimals,
              });
            }
          } catch { /* skip */ }
        });
      });
      await Promise.allSettled(promises);
      results.sort((a, b) => parseFloat(b.balance) - parseFloat(a.balance));
      setBalances(results);
    }

    scan();
  }, [account]);

  // Execute payment
  const executePay = async () => {
    if (!provider || !selectedChain || !selectedToken) return;
    setStep("paying");
    setError("");

    try {
      const tokenCfg = STABLECOINS[selectedChain]?.[selectedToken];
      if (!tokenCfg) throw new Error("Invalid token selection");

      const routerAddr = PAYMENT_ROUTER[selectedChain];
      const amountWei = parseUnits(invoice.amount, tokenCfg.decimals);
      const invoiceIdBytes32 = keccak256(toHex(invoice.id));
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);

      // Switch chain
      const chainCfg = SUPPORTED_CHAINS.find((c) => c.name === selectedChain);
      if (chainCfg) {
        try {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: `0x${chainCfg.chainId.toString(16)}` }],
          });
        } catch { /* user may already be on chain */ }
      }

      // 1. Approve
      const allowance = await createPublicClient({
        chain: viemChains[selectedChain],
        transport: http(),
      }).readContract({
        address: tokenCfg.address,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [account as `0x${string}`, routerAddr],
      }) as bigint;

      if (allowance < amountWei) {
        const approveData = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [routerAddr, maxUint256],
        });
        await provider.request({
          method: "eth_sendTransaction",
          params: [{ from: account, to: tokenCfg.address, data: approveData }],
        });
        // Wait a moment for approval to propagate
        await new Promise((r) => setTimeout(r, 3000));
      }

      // 2. Pay
      const merchantAddr = "0x0000000000000000000000000000000000000000"; // TODO: from merchant config
      const payData = encodeFunctionData({
        abi: PAYMENT_ROUTER_ABI,
        functionName: "pay",
        args: [{
          invoiceId: invoiceIdBytes32,
          token: tokenCfg.address,
          amount: amountWei,
          merchant: merchantAddr as `0x${string}`,
          referrer: "0x0000000000000000000000000000000000000000" as `0x${string}`,
          serviceFeeBps: 80,
          referrerFeeBps: 0,
          deadline,
        }],
      });

      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: account, to: routerAddr, data: payData }],
      });

      setTxHash(hash);
      setStep("confirming");

      // 3. Submit to backend for tracking
      await submitTransaction(invoice.id, {
        txHash: hash,
        payerAddress: account,
        toAddress: routerAddr,
        chain: selectedChain,
        token: selectedToken,
      });

      // 4. Wait for confirmation
      const confirmed = await pollInvoiceStatus(invoice.id);
      setStep(confirmed.status === "confirmed" ? "success" : "failed");
    } catch (err: any) {
      setError(err.message || "Payment failed");
      setStep("select");
    }
  };

  if (isExpired) {
    return (
      <div className="max-w-md mx-auto p-6 text-center">
        <div className="text-6xl mb-4">&#9202;</div>
        <h2 className="text-xl font-bold text-red-600">Invoice Expired</h2>
        <p className="text-gray-500 mt-2">This payment link has expired. Please request a new one.</p>
      </div>
    );
  }

  if (invoice.status === "confirmed") {
    return (
      <div className="max-w-md mx-auto p-6 text-center">
        <div className="text-6xl mb-4">&#10003;</div>
        <h2 className="text-xl font-bold text-green-600">Payment Confirmed</h2>
        <p className="text-gray-500 mt-2">${invoice.amount} USD has been paid.</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-2xl shadow-lg">
      {/* Header */}
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold">ButterPay</h1>
        <p className="text-gray-500 mt-1">{invoice.description || "Payment"}</p>
        <p className="text-3xl font-bold mt-2">${invoice.amount} USD</p>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">{error}</div>
      )}

      {/* Step: Connect */}
      {step === "connect" && (
        <button
          onClick={connectWallet}
          className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 px-4 rounded-xl transition"
        >
          Connect Wallet
        </button>
      )}

      {/* Step: Select chain & token */}
      {step === "select" && (
        <div>
          <p className="text-sm text-gray-500 mb-2 truncate">
            Connected: {account}
          </p>

          {balances.length === 0 ? (
            <p className="text-center text-gray-400 py-4">Scanning balances...</p>
          ) : (
            <div className="space-y-2 mb-4">
              <p className="text-sm font-medium text-gray-700">Select payment method:</p>
              {balances.map((b) => {
                const isSelected = b.chain === selectedChain && b.token === selectedToken;
                const chainLabel = SUPPORTED_CHAINS.find((c) => c.name === b.chain)?.label || b.chain;
                return (
                  <button
                    key={`${b.chain}-${b.token}`}
                    onClick={() => { setSelectedChain(b.chain); setSelectedToken(b.token); }}
                    className={`w-full text-left p-3 rounded-xl border transition ${
                      isSelected ? "border-amber-500 bg-amber-50" : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex justify-between">
                      <span className="font-medium">{b.token} on {chainLabel}</span>
                      <span className="text-gray-500">{parseFloat(b.balance).toFixed(2)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <button
            onClick={executePay}
            disabled={!selectedChain || !selectedToken}
            className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white font-semibold py-3 px-4 rounded-xl transition"
          >
            Pay ${invoice.amount} {selectedToken || ""}
          </button>
        </div>
      )}

      {/* Step: Paying */}
      {step === "paying" && (
        <div className="text-center py-8">
          <div className="animate-spin text-4xl mb-4">&#9881;</div>
          <p className="text-gray-600">Confirm in your wallet...</p>
        </div>
      )}

      {/* Step: Confirming */}
      {step === "confirming" && (
        <div className="text-center py-8">
          <div className="animate-pulse text-4xl mb-4">&#9203;</div>
          <p className="text-gray-600">Waiting for on-chain confirmation...</p>
          {txHash && (
            <p className="text-xs text-gray-400 mt-2 truncate">Tx: {txHash}</p>
          )}
        </div>
      )}

      {/* Step: Success */}
      {step === "success" && (
        <div className="text-center py-8">
          <div className="text-6xl mb-4 text-green-500">&#10003;</div>
          <h2 className="text-xl font-bold text-green-600">Payment Confirmed!</h2>
          <p className="text-gray-500 mt-2">${invoice.amount} USD paid successfully.</p>
          {invoice.redirectUrl && (
            <a href={invoice.redirectUrl} className="mt-4 inline-block text-amber-600 underline">
              Return to merchant
            </a>
          )}
        </div>
      )}

      {/* Step: Failed */}
      {step === "failed" && (
        <div className="text-center py-8">
          <div className="text-6xl mb-4 text-red-500">&#10007;</div>
          <h2 className="text-xl font-bold text-red-600">Payment Failed</h2>
          <button
            onClick={() => setStep("select")}
            className="mt-4 bg-amber-500 text-white py-2 px-6 rounded-xl"
          >
            Try Again
          </button>
        </div>
      )}

      <p className="text-center text-xs text-gray-400 mt-6">Powered by ButterPay</p>
    </div>
  );
}
