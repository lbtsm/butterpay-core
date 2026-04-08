const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
} = require("discord.js");
require("dotenv").config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const PAY_URL = process.env.PAY_URL || "https://pay.butterpay.io";

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  console.error("DISCORD_TOKEN and DISCORD_CLIENT_ID are required");
  process.exit(1);
}

// ========================= Register Commands =========================

const commands = [
  new SlashCommandBuilder()
    .setName("pay")
    .setDescription("Create a payment request")
    .addStringOption((opt) =>
      opt.setName("amount").setDescription("Payment amount").setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("token")
        .setDescription("Token (USDT/USDC)")
        .setRequired(false)
        .addChoices(
          { name: "USDT", value: "USDT" },
          { name: "USDC", value: "USDC" }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName("description")
        .setDescription("Payment description")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("butterpay")
    .setDescription("Show ButterPay info and help"),
];

async function registerCommands() {
  const rest = new REST().setToken(DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), {
      body: commands.map((c) => c.toJSON()),
    });
    console.log("Slash commands registered");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
}

// ========================= Bot =========================

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once("ready", () => {
  console.log(`Discord Bot logged in as ${client.user.tag}`);
  registerCommands();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "pay") {
    const amount = interaction.options.getString("amount");
    const token = interaction.options.getString("token") || "USDT";
    const description =
      interaction.options.getString("description") || "Payment";

    if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return interaction.reply({
        content: "Invalid amount. Please enter a positive number.",
        ephemeral: true,
      });
    }

    const payLink = `${PAY_URL}/pay?amount=${amount}&token=${token}&desc=${encodeURIComponent(description)}`;

    const embed = new EmbedBuilder()
      .setTitle("ButterPay Payment Request")
      .setDescription(description)
      .addFields(
        { name: "Amount", value: `${amount} ${token}`, inline: true },
        { name: "Status", value: "Pending", inline: true }
      )
      .setColor(0xf5a623)
      .setFooter({ text: "Powered by ButterPay" })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      content: `[Click here to pay ${amount} ${token}](${payLink})`,
    });
  }

  if (interaction.commandName === "butterpay") {
    const embed = new EmbedBuilder()
      .setTitle("ButterPay")
      .setDescription(
        "Crypto payment infrastructure for communities.\n\n" +
          "**Commands:**\n" +
          "`/pay <amount> [token] [description]` - Create a payment\n" +
          "`/butterpay` - Show this help\n\n" +
          "**Supported tokens:** USDT, USDC\n" +
          "**Supported chains:** ETH, ARB, BSC, Polygon, OP"
      )
      .setColor(0xf5a623)
      .setFooter({ text: "butterpay.io" });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

// Error handling
client.on("error", (err) => {
  console.error("Discord client error:", err);
});

// Start
client.login(DISCORD_TOKEN);
