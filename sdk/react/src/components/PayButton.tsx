import React, { useState, useCallback } from "react";
import { useButterPay } from "../context.js";
import type { PayButtonProps } from "../types.js";

/**
 * Drop-in payment button. Creates an invoice and opens the payment flow.
 * Renders as a styled button with the merchant's theme.
 */
export function PayButton({
  amount,
  description,
  merchantOrderId,
  onSuccess,
  onError,
  label,
  className,
  disabled,
}: PayButtonProps) {
  const { apiUrl, apiKey, theme } = useButterPay();
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(async () => {
    setLoading(true);
    try {
      // Create invoice via API
      const res = await fetch(`${apiUrl}/v1/invoices`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "X-API-Key": apiKey } : {}),
        },
        body: JSON.stringify({
          amountUsd: amount,
          description,
          merchantOrderId,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Failed to create invoice");
      }

      const invoice = await res.json();

      // Open payment page in new window/popup
      const payUrl = `${apiUrl.replace("/api", "")}/pay/${invoice.id}`;
      const popup = window.open(payUrl, "butterpay", "width=440,height=700");

      // Listen for completion via postMessage
      const handler = (event: MessageEvent) => {
        if (event.data?.type === "butterpay:success") {
          onSuccess?.(invoice.id, event.data.txHash);
          window.removeEventListener("message", handler);
          popup?.close();
        }
        if (event.data?.type === "butterpay:error") {
          onError?.(event.data.error);
          window.removeEventListener("message", handler);
        }
      };
      window.addEventListener("message", handler);
    } catch (err: any) {
      onError?.(err.message);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, apiKey, amount, description, merchantOrderId, onSuccess, onError]);

  const buttonStyle: React.CSSProperties = {
    backgroundColor: theme.primaryColor,
    color: "#fff",
    border: "none",
    borderRadius: `${theme.borderRadius}px`,
    padding: "12px 24px",
    fontSize: "16px",
    fontWeight: 600,
    fontFamily: theme.fontFamily,
    cursor: disabled || loading ? "not-allowed" : "pointer",
    opacity: disabled || loading ? 0.6 : 1,
    transition: "opacity 0.2s",
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled || loading}
      className={className}
      style={className ? undefined : buttonStyle}
    >
      {loading ? "Processing..." : label || `Pay $${amount}`}
    </button>
  );
}
