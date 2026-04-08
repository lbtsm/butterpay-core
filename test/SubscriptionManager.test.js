const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("SubscriptionManager", function () {
  let subManager, token;
  let owner, feeCollector, merchant, subscriber, charger;

  const AMOUNT = ethers.parseUnits("10", 6); // $10/month
  const INTERVAL = 30 * 24 * 3600; // 30 days
  const SERVICE_FEE_BPS = 80; // 0.8%

  beforeEach(async function () {
    [owner, feeCollector, merchant, subscriber, charger] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy("USDT", "USDT", 6);

    const SubscriptionManager = await ethers.getContractFactory("SubscriptionManager");
    subManager = await SubscriptionManager.deploy(feeCollector.address, SERVICE_FEE_BPS);

    // Authorize charger
    await subManager.setAuthorizedCharger(charger.address, true);

    // Fund subscriber and approve
    await token.mint(subscriber.address, ethers.parseUnits("10000", 6));
    await token.connect(subscriber).approve(subManager.target, ethers.MaxUint256);
  });

  describe("Subscribe", function () {
    it("should create subscription and execute first charge", async function () {
      const plan = {
        merchant: merchant.address,
        token: token.target,
        amount: AMOUNT,
        interval: INTERVAL,
        expiry: 0,
      };

      const tx = await subManager.connect(subscriber).subscribe(plan);
      await expect(tx).to.emit(subManager, "SubscriptionCreated");
      await expect(tx).to.emit(subManager, "SubscriptionCharged");

      // Check first charge happened
      const serviceFee = ethers.parseUnits("0.08", 6); // 10 * 0.8%
      const merchantReceived = AMOUNT - serviceFee;

      expect(await token.balanceOf(merchant.address)).to.equal(merchantReceived);
      expect(await token.balanceOf(feeCollector.address)).to.equal(serviceFee);

      // Check subscription state
      const sub = await subManager.getSubscription(1);
      expect(sub.subscriber).to.equal(subscriber.address);
      expect(sub.merchant).to.equal(merchant.address);
      expect(sub.active).to.be.true;
    });

    it("should auto-increment subscription IDs", async function () {
      const plan = {
        merchant: merchant.address,
        token: token.target,
        amount: AMOUNT,
        interval: INTERVAL,
        expiry: 0,
      };

      await subManager.connect(subscriber).subscribe(plan);
      await subManager.connect(subscriber).subscribe(plan);

      const sub1 = await subManager.getSubscription(1);
      const sub2 = await subManager.getSubscription(2);
      expect(sub1.subscriber).to.equal(subscriber.address);
      expect(sub2.subscriber).to.equal(subscriber.address);
    });
  });

  describe("Charge", function () {
    it("should charge after interval", async function () {
      const plan = {
        merchant: merchant.address,
        token: token.target,
        amount: AMOUNT,
        interval: INTERVAL,
        expiry: 0,
      };

      await subManager.connect(subscriber).subscribe(plan);

      // Fast forward 30 days
      await time.increase(INTERVAL);

      await expect(subManager.connect(charger).charge(1))
        .to.emit(subManager, "SubscriptionCharged");

      // Two charges total
      const serviceFee = ethers.parseUnits("0.08", 6);
      const merchantPerCharge = AMOUNT - serviceFee;
      expect(await token.balanceOf(merchant.address)).to.equal(merchantPerCharge * 2n);
    });

    it("should reject charge before interval", async function () {
      const plan = {
        merchant: merchant.address,
        token: token.target,
        amount: AMOUNT,
        interval: INTERVAL,
        expiry: 0,
      };

      await subManager.connect(subscriber).subscribe(plan);

      // Try immediate second charge
      await expect(subManager.connect(charger).charge(1))
        .to.be.revertedWith("too early");
    });

    it("should reject unauthorized charger", async function () {
      const plan = {
        merchant: merchant.address,
        token: token.target,
        amount: AMOUNT,
        interval: INTERVAL,
        expiry: 0,
      };

      await subManager.connect(subscriber).subscribe(plan);
      await time.increase(INTERVAL);

      await expect(subManager.connect(subscriber).charge(1))
        .to.be.revertedWith("not authorized");
    });
  });

  describe("Cancel", function () {
    it("should cancel subscription", async function () {
      const plan = {
        merchant: merchant.address,
        token: token.target,
        amount: AMOUNT,
        interval: INTERVAL,
        expiry: 0,
      };

      await subManager.connect(subscriber).subscribe(plan);

      await expect(subManager.connect(subscriber).cancel(1))
        .to.emit(subManager, "SubscriptionCancelled")
        .withArgs(1, subscriber.address);

      const sub = await subManager.getSubscription(1);
      expect(sub.active).to.be.false;
    });

    it("should reject charge on cancelled subscription", async function () {
      const plan = {
        merchant: merchant.address,
        token: token.target,
        amount: AMOUNT,
        interval: INTERVAL,
        expiry: 0,
      };

      await subManager.connect(subscriber).subscribe(plan);
      await subManager.connect(subscriber).cancel(1);

      await time.increase(INTERVAL);

      await expect(subManager.connect(charger).charge(1))
        .to.be.revertedWith("not active");
    });

    it("should reject cancel by non-subscriber", async function () {
      const plan = {
        merchant: merchant.address,
        token: token.target,
        amount: AMOUNT,
        interval: INTERVAL,
        expiry: 0,
      };

      await subManager.connect(subscriber).subscribe(plan);

      await expect(subManager.connect(merchant).cancel(1))
        .to.be.revertedWith("not subscriber");
    });
  });

  describe("Expiry", function () {
    it("should reject charge after expiry", async function () {
      const now = await time.latest();
      const plan = {
        merchant: merchant.address,
        token: token.target,
        amount: AMOUNT,
        interval: INTERVAL,
        expiry: now + INTERVAL * 2, // expires after 2 months
      };

      await subManager.connect(subscriber).subscribe(plan);

      // First renewal OK
      await time.increase(INTERVAL);
      await subManager.connect(charger).charge(1);

      // Second renewal fails (expired)
      await time.increase(INTERVAL);
      await expect(subManager.connect(charger).charge(1))
        .to.be.revertedWith("expired");
    });
  });

  describe("Admin", function () {
    it("should update service fee", async function () {
      await subManager.setServiceFeeBps(50);
      expect(await subManager.serviceFeeBps()).to.equal(50);
    });

    it("should reject fee above cap", async function () {
      await expect(subManager.setServiceFeeBps(600))
        .to.be.revertedWith("fee too high");
    });

    it("should pause and unpause", async function () {
      await subManager.pause();

      const plan = {
        merchant: merchant.address,
        token: token.target,
        amount: AMOUNT,
        interval: INTERVAL,
        expiry: 0,
      };

      await expect(subManager.connect(subscriber).subscribe(plan))
        .to.be.revertedWithCustomError(subManager, "EnforcedPause");

      await subManager.unpause();
      await expect(subManager.connect(subscriber).subscribe(plan))
        .to.emit(subManager, "SubscriptionCreated");
    });
  });
});
