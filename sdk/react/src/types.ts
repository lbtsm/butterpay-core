export interface ButterPayTheme {
  /** Primary brand color (hex) */
  primaryColor?: string;
  /** Background color */
  backgroundColor?: string;
  /** Border radius in px */
  borderRadius?: number;
  /** Custom logo URL */
  logoUrl?: string;
  /** Hide "Powered by ButterPay" */
  hidePoweredBy?: boolean;
  /** Font family */
  fontFamily?: string;
}

export interface ButterPayProviderConfig {
  /** ButterPay API base URL */
  apiUrl: string;
  /** Merchant API key */
  apiKey?: string;
  /** Theme customization */
  theme?: ButterPayTheme;
}

export interface PayButtonProps {
  /** Amount in USD */
  amount: string;
  /** Description shown on payment page */
  description?: string;
  /** Merchant order ID for reconciliation */
  merchantOrderId?: string;
  /** Called when payment is confirmed */
  onSuccess?: (invoiceId: string, txHash: string) => void;
  /** Called when payment fails */
  onError?: (error: string) => void;
  /** Button text override */
  label?: string;
  /** Custom className */
  className?: string;
  /** Disable the button */
  disabled?: boolean;
}

export interface PaymentModalProps {
  /** Invoice ID to pay */
  invoiceId: string;
  /** Whether the modal is open */
  open: boolean;
  /** Close handler */
  onClose: () => void;
  /** Called on confirmed payment */
  onSuccess?: (txHash: string) => void;
  /** Called on error */
  onError?: (error: string) => void;
}
