const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // --- Config ---
  const serviceFeeCollector = process.env.FEE_COLLECTOR || deployer.address;
  const serviceFeeBps = 80; // 0.8%

  // --- PaymentReceiver ---
  const PaymentReceiver = await ethers.getContractFactory("PaymentReceiver");
  const paymentReceiver = await PaymentReceiver.deploy(serviceFeeCollector);
  await paymentReceiver.waitForDeployment();
  console.log("PaymentReceiver deployed to:", paymentReceiver.target);

  // --- Splitter ---
  const Splitter = await ethers.getContractFactory("Splitter");
  const splitter = await Splitter.deploy();
  await splitter.waitForDeployment();
  console.log("Splitter deployed to:", splitter.target);

  // --- SubscriptionManager ---
  const SubscriptionManager = await ethers.getContractFactory("SubscriptionManager");
  const subManager = await SubscriptionManager.deploy(serviceFeeCollector, serviceFeeBps);
  await subManager.waitForDeployment();
  console.log("SubscriptionManager deployed to:", subManager.target);

  console.log("\nDeployment complete!");
  console.log("Service fee collector:", serviceFeeCollector);
  console.log("Service fee:", serviceFeeBps, "bps (0.8%)");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
