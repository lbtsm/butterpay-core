/**
 * ButterPay Lite Widget
 *
 * Zero-code embed: add one <script> tag + one <div> to any page.
 *
 * Usage:
 *   <div id="butterpay-button"
 *        data-amount="10.00"
 *        data-description="Premium Plan"
 *        data-api-url="https://api.butterpay.io"
 *        data-api-key="bp_xxx"
 *        data-theme-color="#f59e0b"
 *        data-merchant-order-id="order-123"
 *        data-on-success="onPaymentSuccess"
 *        data-on-error="onPaymentError">
 *   </div>
 *   <script src="https://cdn.butterpay.io/widget.js"></script>
 */
(function () {
  "use strict";

  const WIDGET_VERSION = "0.1.0";

  function init() {
    const containers = document.querySelectorAll("[id^='butterpay-button']");
    containers.forEach(renderButton);
  }

  function renderButton(container) {
    const amount = container.dataset.amount;
    const description = container.dataset.description || "";
    const apiUrl = container.dataset.apiUrl || "https://api.butterpay.io";
    const apiKey = container.dataset.apiKey || "";
    const themeColor = container.dataset.themeColor || "#f59e0b";
    const merchantOrderId = container.dataset.merchantOrderId || "";
    const onSuccessFn = container.dataset.onSuccess || "";
    const onErrorFn = container.dataset.onError || "";
    const label = container.dataset.label || "Pay $" + amount;
    const hidePoweredBy = container.dataset.hidePoweredBy === "true";

    if (!amount) {
      console.error("[ButterPay Widget] data-amount is required");
      return;
    }

    // Create button
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.cssText =
      "background:" + themeColor + ";color:#fff;border:none;border-radius:12px;" +
      "padding:12px 24px;font-size:16px;font-weight:600;cursor:pointer;" +
      "font-family:system-ui,-apple-system,sans-serif;transition:opacity 0.2s;";

    btn.onmouseenter = function () { btn.style.opacity = "0.85"; };
    btn.onmouseleave = function () { btn.style.opacity = "1"; };

    btn.onclick = function () {
      btn.disabled = true;
      btn.textContent = "Processing...";
      btn.style.opacity = "0.6";
      btn.style.cursor = "not-allowed";

      createInvoiceAndPay({
        amount: amount,
        description: description,
        apiUrl: apiUrl,
        apiKey: apiKey,
        merchantOrderId: merchantOrderId,
        themeColor: themeColor,
        onSuccessFn: onSuccessFn,
        onErrorFn: onErrorFn,
      }).finally(function () {
        btn.disabled = false;
        btn.textContent = label;
        btn.style.opacity = "1";
        btn.style.cursor = "pointer";
      });
    };

    container.innerHTML = "";
    container.appendChild(btn);

    if (!hidePoweredBy) {
      var powered = document.createElement("div");
      powered.textContent = "Powered by ButterPay";
      powered.style.cssText =
        "text-align:center;font-size:11px;color:#aaa;margin-top:6px;" +
        "font-family:system-ui,-apple-system,sans-serif;";
      container.appendChild(powered);
    }
  }

  async function createInvoiceAndPay(opts) {
    try {
      // 1. Create invoice
      var headers = { "Content-Type": "application/json" };
      if (opts.apiKey) headers["X-API-Key"] = opts.apiKey;

      var res = await fetch(opts.apiUrl + "/v1/invoices", {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          amountUsd: opts.amount,
          description: opts.description,
          merchantOrderId: opts.merchantOrderId,
        }),
      });

      if (!res.ok) {
        var err = await res.json().catch(function () { return {}; });
        throw new Error(err.error || "Failed to create invoice");
      }

      var invoice = await res.json();

      // 2. Open payment popup
      var payUrl = opts.apiUrl.replace("/api", "").replace(/\/$/, "") + "/pay/" + invoice.id;
      var popup = window.open(payUrl, "butterpay", "width=440,height=700,scrollbars=yes");

      // 3. Listen for result via postMessage
      return new Promise(function (resolve) {
        function handler(event) {
          if (event.data && event.data.type === "butterpay:success") {
            window.removeEventListener("message", handler);
            if (popup) popup.close();
            if (opts.onSuccessFn && typeof window[opts.onSuccessFn] === "function") {
              window[opts.onSuccessFn](invoice.id, event.data.txHash);
            }
            resolve();
          }
          if (event.data && event.data.type === "butterpay:error") {
            window.removeEventListener("message", handler);
            if (opts.onErrorFn && typeof window[opts.onErrorFn] === "function") {
              window[opts.onErrorFn](event.data.error);
            }
            resolve();
          }
        }
        window.addEventListener("message", handler);

        // Fallback: if popup is closed without message
        var check = setInterval(function () {
          if (popup && popup.closed) {
            clearInterval(check);
            window.removeEventListener("message", handler);
            resolve();
          }
        }, 1000);
      });
    } catch (err) {
      if (opts.onErrorFn && typeof window[opts.onErrorFn] === "function") {
        window[opts.onErrorFn](err.message);
      } else {
        console.error("[ButterPay Widget]", err.message);
      }
    }
  }

  // Auto-init on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Expose for manual re-init
  window.ButterPayWidget = { init: init, version: WIDGET_VERSION };
})();
