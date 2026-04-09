import React, { createContext, useContext, useMemo } from "react";
import type { ButterPayProviderConfig, ButterPayTheme } from "./types.js";

interface ButterPayContextValue {
  apiUrl: string;
  apiKey?: string;
  theme: Required<ButterPayTheme>;
}

const defaultTheme: Required<ButterPayTheme> = {
  primaryColor: "#f59e0b",
  backgroundColor: "#ffffff",
  borderRadius: 12,
  logoUrl: "",
  hidePoweredBy: false,
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const ButterPayContext = createContext<ButterPayContextValue | null>(null);

export function ButterPayProvider({
  config,
  children,
}: {
  config: ButterPayProviderConfig;
  children: React.ReactNode;
}) {
  const value = useMemo<ButterPayContextValue>(
    () => ({
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      theme: { ...defaultTheme, ...config.theme },
    }),
    [config]
  );

  return (
    <ButterPayContext.Provider value={value}>
      {children}
    </ButterPayContext.Provider>
  );
}

export function useButterPay(): ButterPayContextValue {
  const ctx = useContext(ButterPayContext);
  if (!ctx) throw new Error("useButterPay must be used within <ButterPayProvider>");
  return ctx;
}
