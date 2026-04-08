const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Splitter", function () {
  let splitter, token;
  let payer, creator, platform, butterpay;

  const AMOUNT = ethers.parseUnits("100", 6);

  beforeEach(async function () {
    [payer, creator, platform, butterpay] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy("USDT", "USDT", 6);

    const Splitter = await ethers.getContractFactory("Splitter");
    splitter = await Splitter.deploy();

    await token.mint(payer.address, ethers.parseUnits("10000", 6));
    await token.connect(payer).approve(splitter.target, ethers.MaxUint256);
  });

  function invoiceId(str) {
    return ethers.id(str);
  }

  it("should split payment among multiple recipients", async function () {
    // Creator 80%, Platform 19.2%, ButterPay 0.8%
    const splits = [
      { recipient: creator.address, bps: 8000 },
      { recipient: platform.address, bps: 1920 },
      { recipient: butterpay.address, bps: 80 },
    ];

    await expect(
      splitter.connect(payer).splitPay(invoiceId("split-001"), token.target, AMOUNT, splits)
    ).to.emit(splitter, "SplitPayment");

    expect(await token.balanceOf(creator.address)).to.equal(ethers.parseUnits("80", 6));
    expect(await token.balanceOf(platform.address)).to.equal(ethers.parseUnits("19.2", 6));
    expect(await token.balanceOf(butterpay.address)).to.equal(ethers.parseUnits("0.8", 6));
  });

  it("should handle two-way split", async function () {
    const splits = [
      { recipient: creator.address, bps: 5000 },
      { recipient: platform.address, bps: 5000 },
    ];

    await splitter.connect(payer).splitPay(invoiceId("split-002"), token.target, AMOUNT, splits);

    expect(await token.balanceOf(creator.address)).to.equal(ethers.parseUnits("50", 6));
    expect(await token.balanceOf(platform.address)).to.equal(ethers.parseUnits("50", 6));
  });

  it("should handle rounding dust correctly (last recipient gets remainder)", async function () {
    // 3 USDT split 3 ways: 3333 + 3333 + 3334 = 10000
    const amount = ethers.parseUnits("3", 6); // 3_000_000
    const splits = [
      { recipient: creator.address, bps: 3333 },
      { recipient: platform.address, bps: 3333 },
      { recipient: butterpay.address, bps: 3334 },
    ];

    await splitter.connect(payer).splitPay(invoiceId("split-dust"), token.target, amount, splits);

    const b1 = await token.balanceOf(creator.address);
    const b2 = await token.balanceOf(platform.address);
    const b3 = await token.balanceOf(butterpay.address);

    // Total must equal exactly 3 USDT
    expect(b1 + b2 + b3).to.equal(amount);
  });

  describe("Validations", function () {
    it("should reject bps not summing to 10000", async function () {
      const splits = [
        { recipient: creator.address, bps: 5000 },
        { recipient: platform.address, bps: 4000 },
      ];

      await expect(
        splitter.connect(payer).splitPay(invoiceId("bad"), token.target, AMOUNT, splits)
      ).to.be.revertedWith("bps must sum to 10000");
    });

    it("should reject empty splits", async function () {
      await expect(
        splitter.connect(payer).splitPay(invoiceId("empty"), token.target, AMOUNT, [])
      ).to.be.revertedWith("bad splits length");
    });

    it("should reject zero recipient", async function () {
      const splits = [
        { recipient: ethers.ZeroAddress, bps: 10000 },
      ];

      await expect(
        splitter.connect(payer).splitPay(invoiceId("zerorcpt"), token.target, AMOUNT, splits)
      ).to.be.revertedWith("zero recipient");
    });

    it("should reject zero amount", async function () {
      const splits = [
        { recipient: creator.address, bps: 10000 },
      ];

      await expect(
        splitter.connect(payer).splitPay(invoiceId("zeroamt"), token.target, 0, splits)
      ).to.be.revertedWith("zero amount");
    });
  });
});
