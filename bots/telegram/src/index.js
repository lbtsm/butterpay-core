const { Telegraf, Markup } = require("telegraf");
require("dotenv").config();

const BOT_TOKEN = process.env.TG_BOT_TOKEN;
const MINI_APP_URL = process.env.MINI_APP_URL || "https://pay.butterpay.io";
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

if (!BOT_TOKEN) {
  console.error("TG_BOT_TOKEN is required");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// /start command
bot.start((ctx) => {
  ctx.reply(
    "Welcome to ButterPay! Pay with crypto anywhere.\n\n" +
      "Commands:\n" +
      "/pay <amount> <token> - Create a payment\n" +
      "/wallet - Open your wallet\n" +
      "/help - Show help",
    Markup.inlineKeyboard([
      [Markup.button.webApp("Open Wallet", MINI_APP_URL)],
    ])
  );
});

// /pay command - generate payment link
bot.command("pay", async (ctx) => {
  const args = ctx.message.text.split(" ").slice(1);

  if (args.length < 1) {
    return ctx.reply(
      "Usage: /pay <amount> [token]\n" +
        "Example: /pay 10 USDT\n" +
        "Example: /pay 5.50"
    );
  }

  const amount = args[0];
  const token = (args[1] || "USDT").toUpperCase();

  if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return ctx.reply("Invalid amount. Please enter a positive number.");
  }

  const payUrl = `${MINI_APP_URL}/pay?amount=${amount}&token=${token}`;

  ctx.reply(
    `Payment: ${amount} ${token}\n\nClick below to pay:`,
    Markup.inlineKeyboard([
      [Markup.button.webApp(`Pay ${amount} ${token}`, payUrl)],
    ])
  );
});

// /wallet command
bot.command("wallet", (ctx) => {
  ctx.reply(
    "Open your ButterPay wallet:",
    Markup.inlineKeyboard([
      [Markup.button.webApp("Open Wallet", MINI_APP_URL)],
    ])
  );
});

// /help command
bot.command("help", (ctx) => {
  ctx.reply(
    "ButterPay - Crypto Payment Bot\n\n" +
      "Commands:\n" +
      "/pay <amount> [token] - Create a payment request\n" +
      "/wallet - Open your wallet\n" +
      "/help - Show this help\n\n" +
      "Supported tokens: USDT, USDC\n" +
      "Supported chains: ETH, ARB, BSC, Polygon, OP"
  );
});

// Webhook handler for payment notifications (called by backend)
// In production, this would listen for webhook events and notify users
bot.on("callback_query", async (ctx) => {
  await ctx.answerCbQuery();
});

// Error handling
bot.catch((err, ctx) => {
  console.error(`Bot error for ${ctx.updateType}:`, err);
});

// Start
bot
  .launch()
  .then(() => console.log("TG Bot started"))
  .catch((err) => {
    console.error("Failed to start TG bot:", err);
    process.exit(1);
  });

// Graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
