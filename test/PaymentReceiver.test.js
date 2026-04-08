const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PaymentReceiver", function () {
  let paymentReceiver, token;
  let owner, feeCollector, merchant, payer, referrer;

  const AMOUNT = ethers.parseUnits("100", 6); // 100 USDT
  const SERVICE_FEE_BPS = 80; // 0.8%
  const REFERRER_FEE_BPS = 20; // 0.2%

  beforeEach(async function () {
    [owner, feeCollector, merchant, payer, referrer] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy("USDT", "USDT", 6);

    const PaymentReceiver = await ethers.getContractFactory("PaymentReceiver");
    paymentReceiver = await PaymentReceiver.deploy(feeCollector.address);

    // Mint tokens to payer and approve
    await token.mint(payer.address, ethers.parseUnits("10000", 6));
    await token.connect(payer).approve(paymentReceiver.target, ethers.MaxUint256);
  });

  function invoiceId(str) {
    return ethers.id(str);
  }

  describe("Basic Payment", function () {
    it("should process payment with service fee", async function () {
      const params = {
        invoiceId: invoiceId("inv-001"),
        token: token.target,
        amount: AMOUNT,
        merchant: merchant.address,
        referrer: ethers.ZeroAddress,
        serviceFeeBps: SERVICE_FEE_BPS,
        referrerFeeBps: 0,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      };

      await expect(paymentReceiver.connect(payer).pay(params))
        .to.emit(paymentReceiver, "PaymentProcessed");

      // service fee = 100 * 0.8% = 0.8 USDT
      const serviceFee = ethers.parseUnits("0.8", 6);
      const merchantReceived = AMOUNT - serviceFee;

      expect(await token.balanceOf(merchant.address)).to.equal(merchantReceived);
      expect(await token.balanceOf(feeCollector.address)).to.equal(serviceFee);
    });

    it("should process payment with referrer", async function () {
      const params = {
        invoiceId: invoiceId("inv-002"),
        token: token.target,
        amount: AMOUNT,
        merchant: merchant.address,
        referrer: referrer.address,
        serviceFeeBps: SERVICE_FEE_BPS,
        referrerFeeBps: REFERRER_FEE_BPS,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      };

      await paymentReceiver.connect(payer).pay(params);

      // service fee = 100 * 0.8% = 0.8 USDT
      // referrer fee = 100 * 0.2% = 0.2 USDT (from service fee)
      // collector fee = 0.8 - 0.2 = 0.6 USDT
      const serviceFee = ethers.parseUnits("0.8", 6);
      const referrerFee = ethers.parseUnits("0.2", 6);
      const collectorFee = serviceFee - referrerFee;
      const merchantReceived = AMOUNT - serviceFee;

      expect(await token.balanceOf(merchant.address)).to.equal(merchantReceived);
      expect(await token.balanceOf(feeCollector.address)).to.equal(collectorFee);
      expect(await token.balanceOf(referrer.address)).to.equal(referrerFee);
    });

    it("should mark invoice as paid", async function () {
      const id = invoiceId("inv-003");
      expect(await paymentReceiver.isPaid(id)).to.be.false;

      await paymentReceiver.connect(payer).pay({
        invoiceId: id,
        token: token.target,
        amount: AMOUNT,
        merchant: merchant.address,
        referrer: ethers.ZeroAddress,
        serviceFeeBps: SERVICE_FEE_BPS,
        referrerFeeBps: 0,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      });

      expect(await paymentReceiver.isPaid(id)).to.be.true;
    });

    it("should process payment with zero service fee", async function () {
      const params = {
        invoiceId: invoiceId("inv-free"),
        token: token.target,
        amount: AMOUNT,
        merchant: merchant.address,
        referrer: ethers.ZeroAddress,
        serviceFeeBps: 0,
        referrerFeeBps: 0,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      };

      await paymentReceiver.connect(payer).pay(params);

      expect(await token.balanceOf(merchant.address)).to.equal(AMOUNT);
      expect(await token.balanceOf(feeCollector.address)).to.equal(0);
    });
  });

  describe("Validations", function () {
    it("should reject double payment", async function () {
      const id = invoiceId("inv-dup");
      const params = {
        invoiceId: id,
        token: token.target,
        amount: AMOUNT,
        merchant: merchant.address,
        referrer: ethers.ZeroAddress,
        serviceFeeBps: SERVICE_FEE_BPS,
        referrerFeeBps: 0,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      };

      await paymentReceiver.connect(payer).pay(params);
      await expect(paymentReceiver.connect(payer).pay(params))
        .to.be.revertedWith("already paid");
    });

    it("should reject expired payment", async function () {
      const params = {
        invoiceId: invoiceId("inv-expired"),
        token: token.target,
        amount: AMOUNT,
        merchant: merchant.address,
        referrer: ethers.ZeroAddress,
        serviceFeeBps: SERVICE_FEE_BPS,
        referrerFeeBps: 0,
        deadline: 1, // already expired
      };

      await expect(paymentReceiver.connect(payer).pay(params))
        .to.be.revertedWith("expired");
    });

    it("should reject zero amount", async function () {
      const params = {
        invoiceId: invoiceId("inv-zero"),
        token: token.target,
        amount: 0,
        merchant: merchant.address,
        referrer: ethers.ZeroAddress,
        serviceFeeBps: SERVICE_FEE_BPS,
        referrerFeeBps: 0,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      };

      await expect(paymentReceiver.connect(payer).pay(params))
        .to.be.revertedWith("zero amount");
    });

    it("should reject zero merchant", async function () {
      const params = {
        invoiceId: invoiceId("inv-nomerch"),
        token: token.target,
        amount: AMOUNT,
        merchant: ethers.ZeroAddress,
        referrer: ethers.ZeroAddress,
        serviceFeeBps: SERVICE_FEE_BPS,
        referrerFeeBps: 0,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      };

      await expect(paymentReceiver.connect(payer).pay(params))
        .to.be.revertedWith("zero merchant");
    });

    it("should reject fee too high", async function () {
      const params = {
        invoiceId: invoiceId("inv-highfee"),
        token: token.target,
        amount: AMOUNT,
        merchant: merchant.address,
        referrer: ethers.ZeroAddress,
        serviceFeeBps: 600, // 6% > 5% cap
        referrerFeeBps: 0,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      };

      await expect(paymentReceiver.connect(payer).pay(params))
        .to.be.revertedWith("fee too high");
    });

    it("should reject referrer fee > service fee", async function () {
      const params = {
        invoiceId: invoiceId("inv-badref"),
        token: token.target,
        amount: AMOUNT,
        merchant: merchant.address,
        referrer: referrer.address,
        serviceFeeBps: 80,
        referrerFeeBps: 100, // > 80
        deadline: Math.floor(Date.now() / 1000) + 3600,
      };

      await expect(paymentReceiver.connect(payer).pay(params))
        .to.be.revertedWith("referrer > service");
    });
  });

  describe("Admin", function () {
    it("should update fee collector", async function () {
      await expect(paymentReceiver.setServiceFeeCollector(referrer.address))
        .to.emit(paymentReceiver, "ServiceFeeCollectorUpdated")
        .withArgs(feeCollector.address, referrer.address);

      expect(await paymentReceiver.serviceFeeCollector()).to.equal(referrer.address);
    });

    it("should reject non-owner setting fee collector", async function () {
      await expect(paymentReceiver.connect(payer).setServiceFeeCollector(payer.address))
        .to.be.revertedWithCustomError(paymentReceiver, "OwnableUnauthorizedAccount");
    });

    it("should pause and unpause", async function () {
      await paymentReceiver.pause();

      const params = {
        invoiceId: invoiceId("inv-paused"),
        token: token.target,
        amount: AMOUNT,
        merchant: merchant.address,
        referrer: ethers.ZeroAddress,
        serviceFeeBps: SERVICE_FEE_BPS,
        referrerFeeBps: 0,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      };

      await expect(paymentReceiver.connect(payer).pay(params))
        .to.be.revertedWithCustomError(paymentReceiver, "EnforcedPause");

      await paymentReceiver.unpause();

      await expect(paymentReceiver.connect(payer).pay(params))
        .to.emit(paymentReceiver, "PaymentProcessed");
    });

    it("should support token whitelist", async function () {
      await paymentReceiver.setTokenWhitelistEnabled(true);

      const params = {
        invoiceId: invoiceId("inv-wl"),
        token: token.target,
        amount: AMOUNT,
        merchant: merchant.address,
        referrer: ethers.ZeroAddress,
        serviceFeeBps: SERVICE_FEE_BPS,
        referrerFeeBps: 0,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      };

      await expect(paymentReceiver.connect(payer).pay(params))
        .to.be.revertedWith("token not allowed");

      await paymentReceiver.setTokenWhitelist(token.target, true);
      await expect(paymentReceiver.connect(payer).pay(params))
        .to.emit(paymentReceiver, "PaymentProcessed");
    });
  });
});
