const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ButterPayDelegate", function () {
  let delegate, router, token;
  let owner, feeCollector, merchant, payer;

  const AMOUNT = ethers.parseUnits("100", 6);

  beforeEach(async function () {
    [owner, feeCollector, merchant, payer] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token = await MockERC20.deploy("USDT", "USDT", 6);

    const PaymentRouter = await ethers.getContractFactory("PaymentRouter");
    router = await PaymentRouter.deploy(feeCollector.address);

    const ButterPayDelegate = await ethers.getContractFactory("ButterPayDelegate");
    delegate = await ButterPayDelegate.deploy();

    await token.mint(payer.address, ethers.parseUnits("10000", 6));
  });

  it("should execute batch calls atomically", async function () {
    // In real EIP-7702, execute() runs as the EOA. In test we simulate
    // the batch mechanism by using delegate-owned tokens.
    // Fund the delegate to simulate EOA context.
    await token.mint(delegate.target, AMOUNT);

    const invoiceId = ethers.id("inv-batch-001");
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    // Call 1: delegate approves router (in 7702 context, this is the EOA approving)
    const approveData = token.interface.encodeFunctionData("approve", [
      router.target,
      AMOUNT,
    ]);

    // Call 2: delegate calls router.pay() (in 7702, msg.sender == EOA)
    const payData = router.interface.encodeFunctionData("pay", [
      {
        invoiceId,
        token: token.target,
        amount: AMOUNT,
        merchant: merchant.address,
        referrer: ethers.ZeroAddress,
        serviceFeeBps: 80,
        referrerFeeBps: 0,
        deadline,
      },
    ]);

    // Execute batch: approve + pay in one tx
    await expect(
      delegate.connect(payer).execute([
        { target: token.target, value: 0, data: approveData },
        { target: router.target, value: 0, data: payData },
      ])
    ).to.emit(delegate, "Executed").withArgs(payer.address, 2);

    // Verify payment went through
    expect(await router.isPaid(invoiceId)).to.be.true;

    const serviceFee = ethers.parseUnits("0.8", 6);
    expect(await token.balanceOf(merchant.address)).to.equal(AMOUNT - serviceFee);
    expect(await token.balanceOf(feeCollector.address)).to.equal(serviceFee);
  });

  it("should revert entire batch if one call fails", async function () {
    // Fund delegate with less than needed
    await token.mint(delegate.target, ethers.parseUnits("1", 6));

    const invoiceId = ethers.id("inv-batch-fail");
    const approveData = token.interface.encodeFunctionData("approve", [router.target, AMOUNT]);
    const payData = router.interface.encodeFunctionData("pay", [{
      invoiceId, token: token.target, amount: AMOUNT,
      merchant: merchant.address, referrer: ethers.ZeroAddress,
      serviceFeeBps: 80, referrerFeeBps: 0,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    }]);

    // approve succeeds but pay fails (insufficient balance) → entire batch reverts
    await expect(
      delegate.connect(payer).execute([
        { target: token.target, value: 0, data: approveData },
        { target: router.target, value: 0, data: payData },
      ])
    ).to.be.reverted;

    // Nothing was paid
    expect(await router.isPaid(invoiceId)).to.be.false;
  });

  it("should reject empty batch", async function () {
    await expect(delegate.execute([])).to.be.revertedWith("invalid batch size");
  });

  it("should reject batch > 10", async function () {
    const calls = Array(11).fill({ target: token.target, value: 0, data: "0x" });
    await expect(delegate.execute(calls)).to.be.revertedWith("invalid batch size");
  });

  it("should reject zero target", async function () {
    await expect(
      delegate.execute([{ target: ethers.ZeroAddress, value: 0, data: "0x" }])
    ).to.be.revertedWith("zero target");
  });

  it("should allow receiving ETH", async function () {
    await owner.sendTransaction({ to: delegate.target, value: ethers.parseEther("0.1") });
    expect(await ethers.provider.getBalance(delegate.target)).to.equal(ethers.parseEther("0.1"));
  });
});
