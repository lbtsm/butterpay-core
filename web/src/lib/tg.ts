/**
 * Telegram Mini App environment detection and utilities.
 * Same React app, TG-specific behavior when running inside TG WebView.
 */

export function isTelegramMiniApp(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window as any).Telegram?.WebApp;
}

export function getTelegramWebApp() {
  if (!isTelegramMiniApp()) return null;
  return (window as any).Telegram.WebApp;
}

export function getTelegramInitData(): string | null {
  const wa = getTelegramWebApp();
  return wa?.initData || null;
}

export function getTelegramUserId(): string | null {
  const wa = getTelegramWebApp();
  return wa?.initDataUnsafe?.user?.id?.toString() || null;
}

/**
 * Apply TG-specific fixes:
 * - Disable vertical swipes (prevents pull-to-refresh conflicts)
 * - Expand to full height
 * - Set header color
 */
export function initTelegramMiniApp() {
  const wa = getTelegramWebApp();
  if (!wa) return;

  wa.ready();
  wa.expand();

  if (wa.disableVerticalSwipes) {
    wa.disableVerticalSwipes();
  }

  wa.setHeaderColor("#ffffff");
  wa.setBackgroundColor("#f9fafb");
}

/**
 * Open external link from TG (uses TG SDK openLink to handle TG restrictions)
 */
export function openExternalLink(url: string) {
  const wa = getTelegramWebApp();
  if (wa?.openLink) {
    wa.openLink(url);
  } else {
    window.open(url, "_blank");
  }
}
