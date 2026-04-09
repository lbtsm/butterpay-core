import React from "react";
import { useButterPay } from "../context.js";

interface PaymentLinkProps {
  /** Invoice ID */
  invoiceId: string;
  /** Link text */
  children?: React.ReactNode;
  /** Open in new tab */
  newTab?: boolean;
  /** Custom className */
  className?: string;
}

/**
 * Renders a payment link (butterpay.io/pay/xxx style).
 */
export function PaymentLink({
  invoiceId,
  children,
  newTab = true,
  className,
}: PaymentLinkProps) {
  const { apiUrl, theme } = useButterPay();
  const payUrl = `${apiUrl.replace("/api", "")}/pay/${invoiceId}`;

  const style: React.CSSProperties = className
    ? {}
    : {
        color: theme.primaryColor,
        textDecoration: "underline",
        fontFamily: theme.fontFamily,
        cursor: "pointer",
      };

  return (
    <a
      href={payUrl}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener noreferrer" : undefined}
      className={className}
      style={style}
    >
      {children || "Pay with ButterPay"}
    </a>
  );
}
