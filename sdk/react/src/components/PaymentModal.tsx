import React, { useEffect, useRef } from "react";
import { useButterPay } from "../context.js";
import type { PaymentModalProps } from "../types.js";

/**
 * Payment modal that embeds the ButterPay payment page in an iframe overlay.
 * Supports white-label theming.
 */
export function PaymentModal({
  invoiceId,
  open,
  onClose,
  onSuccess,
  onError,
}: PaymentModalProps) {
  const { apiUrl, theme } = useButterPay();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Listen for postMessage from iframe
  useEffect(() => {
    if (!open) return;

    const handler = (event: MessageEvent) => {
      if (event.data?.type === "butterpay:success") {
        onSuccess?.(event.data.txHash);
        onClose();
      }
      if (event.data?.type === "butterpay:error") {
        onError?.(event.data.error);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [open, onSuccess, onError, onClose]);

  if (!open) return null;

  const payUrl = `${apiUrl.replace("/api", "")}/pay/${invoiceId}`;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.5)",
        fontFamily: theme.fontFamily,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          backgroundColor: theme.backgroundColor,
          borderRadius: `${theme.borderRadius}px`,
          width: "420px",
          maxWidth: "95vw",
          height: "680px",
          maxHeight: "90vh",
          overflow: "hidden",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
          position: "relative",
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 1,
            background: "none",
            border: "none",
            fontSize: "20px",
            cursor: "pointer",
            color: "#999",
          }}
        >
          &#10005;
        </button>

        {/* Custom logo */}
        {theme.logoUrl && (
          <div style={{ padding: "16px 16px 0", textAlign: "center" }}>
            <img src={theme.logoUrl} alt="logo" style={{ height: 32 }} />
          </div>
        )}

        {/* Payment iframe */}
        <iframe
          ref={iframeRef}
          src={payUrl}
          style={{
            width: "100%",
            height: theme.logoUrl ? "calc(100% - 60px)" : "100%",
            border: "none",
          }}
          title="ButterPay Payment"
        />

        {/* Powered by */}
        {!theme.hidePoweredBy && (
          <div
            style={{
              position: "absolute",
              bottom: 8,
              left: 0,
              right: 0,
              textAlign: "center",
              fontSize: "11px",
              color: "#aaa",
            }}
          >
            Powered by ButterPay
          </div>
        )}
      </div>
    </div>
  );
}
