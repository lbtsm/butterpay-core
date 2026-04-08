const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PaymentRouter", function () {
  let router, usdt, usdc;
  let owner, feeCollector, merchant, payer, referrer;

  const AMOUNT = ethers.parseUnits("100", 6);
  const SERVICE_FEE_BPS = 80;
  const REFERRER_FEE_BPS = 20;

  beforeEach(async function () {
    [owner, feeCollector, merchant, payer, referrer] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdt = await MockERC20.deploy("USDT", "USDT", 6);

    const PaymentRouter = await ethers.getContractFactory("PaymentRouter");
    router = await PaymentRouter.deploy(feeCollector.address);

    await usdt.mint(payer.address, ethers.parseUnits("10000", 6));
    await usdt.connect(payer).approve(router.target, ethers.MaxUint256);
  });

  function invoiceId(str) {
    return ethers.id(str);
  }

  // ========================= pay() =========================

  describe("pay()", function () {
    it("should process payment with service fee", async function () {
      const params = {
        invoiceId: invoiceId("inv-001"),
        token: usdt.target,
        amount: AMOUNT,
        merchant: merchant.address,
        referrer: ethers.ZeroAddress,
        serviceFeeBps: SERVICE_FEE_BPS,
        referrerFeeBps: 0,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      };

      await expect(router.connect(payer).pay(params))
        .to.emit(router, "PaymentProcessed");

      const serviceFee = ethers.parseUnits("0.8", 6);
      const merchantReceived = AMOUNT - serviceFee;
      expect(await usdt.balanceOf(merchant.address)).to.equal(merchantReceived);
      expect(await usdt.balanceOf(feeCollector.address)).to.equal(serviceFee);
    });

    it("should process payment with referrer", async function () {
      const params = {
        invoiceId: invoiceId("inv-002"),
        token: usdt.target,
        amount: AMOUNT,
        merchant: merchant.address,
        referrer: referrer.address,
        serviceFeeBps: SERVICE_FEE_BPS,
        referrerFeeBps: REFERRER_FEE_BPS,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      };

      await router.connect(payer).pay(params);

      const serviceFee = ethers.parseUnits("0.8", 6);
      const referrerFee = ethers.parseUnits("0.2", 6);
      const collectorFee = serviceFee - referrerFee;
      const merchantReceived = AMOUNT - serviceFee;

      expect(await usdt.balanceOf(merchant.address)).to.equal(merchantReceived);
      expect(await usdt.balanceOf(feeCollector.address)).to.equal(collectorFee);
      expect(await usdt.balanceOf(referrer.address)).to.equal(referrerFee);
    });

    it("should mark invoice as paid", async function () {
      const id = invoiceId("inv-003");
      expect(await router.isPaid(id)).to.be.false;

      await router.connect(payer).pay({
        invoiceId: id, token: usdt.target, amount: AMOUNT,
        merchant: merchant.address, referrer: ethers.ZeroAddress,
        serviceFeeBps: SERVICE_FEE_BPS, referrerFeeBps: 0,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      });

      expect(await router.isPaid(id)).to.be.true;
    });

    it("should reject double payment", async function () {
      const id = invoiceId("inv-dup");
      const params = {
        invoiceId: id, token: usdt.target, amount: AMOUNT,
        merchant: merchant.address, referrer: ethers.ZeroAddress,
        serviceFeeBps: SERVICE_FEE_BPS, referrerFeeBps: 0,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      };
      await router.connect(payer).pay(params);
      await expect(router.connect(payer).pay(params)).to.be.revertedWith("already paid");
    });

    it("should reject expired payment", async function () {
      await expect(router.connect(payer).pay({
        invoiceId: invoiceId("inv-exp"), token: usdt.target, amount: AMOUNT,
        merchant: merchant.address, referrer: ethers.ZeroAddress,
        serviceFeeBps: SERVICE_FEE_BPS, referrerFeeBps: 0, deadline: 1,
      })).to.be.revertedWith("expired");
    });

    it("should reject fee too high", async function () {
      await expect(router.connect(payer).pay({
        invoiceId: invoiceId("inv-hf"), token: usdt.target, amount: AMOUNT,
        merchant: merchant.address, referrer: ethers.ZeroAddress,
        serviceFeeBps: 600, referrerFeeBps: 0,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      })).to.be.revertedWith("fee too high");
    });
  });

  // ========================= payWithPermit() =========================

  describe("payWithPermit()", function () {
    let permitToken;

    beforeEach(async function () {
      const MockERC20Permit = await ethers.getContractFactory("MockERC20Permit");
      permitToken = await MockERC20Permit.deploy("USDC", "USDC", 6);
      await permitToken.mint(payer.address, ethers.parseUnits("10000", 6));
    });

    it("should pay with valid permit signature", async function () {
      const amount = ethers.parseUnits("50", 6);
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      // Build permit signature
      const domain = {
        name: "USDC",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: permitToken.target,
      };
      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const nonce = await permitToken.nonces(payer.address);
      const value = {
        owner: payer.address,
        spender: router.target,
        value: amount,
        nonce,
        deadline,
      };

      const sig = await payer.signTypedData(domain, types, value);
      const { v, r, s } = ethers.Signature.from(sig);

      const params = {
        invoiceId: invoiceId("inv-permit"),
        token: permitToken.target,
        amount,
        merchant: merchant.address,
        referrer: ethers.ZeroAddress,
        serviceFeeBps: SERVICE_FEE_BPS,
        referrerFeeBps: 0,
        deadline,
      };
      const permitParams = { value: amount, deadline, v, r, s };

      await expect(router.connect(payer).payWithPermit(params, permitParams))
        .to.emit(router, "PaymentProcessed");

      const serviceFee = (amount * BigInt(SERVICE_FEE_BPS)) / 10000n;
      expect(await permitToken.balanceOf(merchant.address)).to.equal(amount - serviceFee);
    });

    it("should fallback to existing allowance if permit fails", async function () {
      const amount = ethers.parseUnits("50", 6);
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      // Pre-approve instead of permit
      await permitToken.connect(payer).approve(router.target, amount);

      // Send garbage permit params — should silently fail and use existing allowance
      const params = {
        invoiceId: invoiceId("inv-permit-fallback"),
        token: permitToken.target,
        amount,
        merchant: merchant.address,
        referrer: ethers.ZeroAddress,
        serviceFeeBps: SERVICE_FEE_BPS,
        referrerFeeBps: 0,
        deadline,
      };
      const badPermit = {
        value: amount,
        deadline,
        v: 27,
        r: ethers.ZeroHash,
        s: ethers.ZeroHash,
      };

      await expect(router.connect(payer).payWithPermit(params, badPermit))
        .to.emit(router, "PaymentProcessed");
    });
  });

  // ========================= swapAndPay() =========================

  describe("swapAndPay()", function () {
    let inputToken, dexRouter;

    beforeEach(async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      inputToken = await MockERC20.deploy("WETH", "WETH", 18);
      await inputToken.mint(payer.address, ethers.parseUnits("100", 18));

      const MockDexRouter = await ethers.getContractFactory("MockDexRouter");
      dexRouter = await MockDexRouter.deploy();

      // Whitelist DEX router
      await router.setDexRouter(dexRouter.target, true);

      // Approve PaymentRouter to pull input token
      await inputToken.connect(payer).approve(router.target, ethers.MaxUint256);
    });

    it("should swap and pay atomically", async function () {
      // Swap 100 WETH → 100 USDT (mock 1:1)
      // But USDT has 6 decimals, WETH 18 — use matching amounts for mock
      const inputAmount = ethers.parseUnits("100", 6); // simplified for mock
      await inputToken.mint(payer.address, inputAmount); // ensure enough

      // Encode DEX swap calldata
      const dexCalldata = dexRouter.interface.encodeFunctionData("swap", [
        inputToken.target,
        usdt.target,
        inputAmount,
        inputAmount, // minOutput
        router.target, // recipient = PaymentRouter
      ]);

      const params = {
        invoiceId: invoiceId("inv-swap"),
        inputToken: inputToken.target,
        outputToken: usdt.target,
        inputAmount,
        minOutputAmount: inputAmount,
        merchant: merchant.address,
        referrer: ethers.ZeroAddress,
        serviceFeeBps: SERVICE_FEE_BPS,
        referrerFeeBps: 0,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        dexRouter: dexRouter.target,
        dexCalldata,
      };

      await expect(router.connect(payer).swapAndPay(params))
        .to.emit(router, "SwapPaymentProcessed");

      const serviceFee = (inputAmount * BigInt(SERVICE_FEE_BPS)) / 10000n;
      expect(await usdt.balanceOf(merchant.address)).to.equal(inputAmount - serviceFee);
      expect(await usdt.balanceOf(feeCollector.address)).to.equal(serviceFee);
    });

    it("should reject non-whitelisted DEX router", async function () {
      const inputAmount = ethers.parseUnits("100", 6);
      const dexCalldata = "0x";

      await expect(router.connect(payer).swapAndPay({
        invoiceId: invoiceId("inv-baddex"),
        inputToken: inputToken.target,
        outputToken: usdt.target,
        inputAmount,
        minOutputAmount: inputAmount,
        merchant: merchant.address,
        referrer: ethers.ZeroAddress,
        serviceFeeBps: SERVICE_FEE_BPS,
        referrerFeeBps: 0,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        dexRouter: merchant.address, // not whitelisted
        dexCalldata,
      })).to.be.revertedWith("dex not allowed");
    });
  });

  // ========================= Admin =========================

  describe("Admin", function () {
    it("should pause and unpause", async function () {
      await router.pause();
      await expect(router.connect(payer).pay({
        invoiceId: invoiceId("inv-paused"), token: usdt.target, amount: AMOUNT,
        merchant: merchant.address, referrer: ethers.ZeroAddress,
        serviceFeeBps: SERVICE_FEE_BPS, referrerFeeBps: 0,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      })).to.be.revertedWithCustomError(router, "EnforcedPause");

      await router.unpause();
      await expect(router.connect(payer).pay({
        invoiceId: invoiceId("inv-unpaused"), token: usdt.target, amount: AMOUNT,
        merchant: merchant.address, referrer: ethers.ZeroAddress,
        serviceFeeBps: SERVICE_FEE_BPS, referrerFeeBps: 0,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      })).to.emit(router, "PaymentProcessed");
    });

    it("should whitelist DEX routers", async function () {
      await router.setDexRouter(merchant.address, true);
      expect(await router.allowedDexRouters(merchant.address)).to.be.true;
      await router.setDexRouter(merchant.address, false);
      expect(await router.allowedDexRouters(merchant.address)).to.be.false;
    });
  });
});
