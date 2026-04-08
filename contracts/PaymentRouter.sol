// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IPaymentRouter} from "./interfaces/IPaymentRouter.sol";

/// @title PaymentRouter
/// @notice Unified payment entry point supporting:
///   - pay(): stablecoin payment with prior approve
///   - payWithPermit(): stablecoin payment with EIP-2612 permit (one-sig for USDC)
///   - swapAndPay(): non-stablecoin → DEX swap → stablecoin payment (atomic)
///   Non-custodial: tokens transfer directly from payer to merchant.
contract PaymentRouter is IPaymentRouter, Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_SERVICE_FEE_BPS = 500; // 5% hard cap
    uint16 public constant BPS_DENOMINATOR = 10000;

    /// @notice Address that collects service fees
    address public serviceFeeCollector;

    /// @notice Tracks paid invoices to prevent double-pay
    mapping(bytes32 => bool) public override isPaid;

    /// @notice Whitelisted tokens
    mapping(address => bool) public allowedTokens;
    bool public tokenWhitelistEnabled;

    /// @notice Whitelisted DEX routers for swapAndPay
    mapping(address => bool) public allowedDexRouters;

    constructor(address _serviceFeeCollector) Ownable(msg.sender) {
        require(_serviceFeeCollector != address(0), "zero collector");
        serviceFeeCollector = _serviceFeeCollector;
    }

    // ========================= Admin =========================

    function setServiceFeeCollector(address _collector) external onlyOwner {
        require(_collector != address(0), "zero collector");
        address old = serviceFeeCollector;
        serviceFeeCollector = _collector;
        emit ServiceFeeCollectorUpdated(old, _collector);
    }

    function setTokenWhitelist(address token, bool allowed) external onlyOwner {
        allowedTokens[token] = allowed;
    }

    function setTokenWhitelistEnabled(bool enabled) external onlyOwner {
        tokenWhitelistEnabled = enabled;
    }

    function setDexRouter(address router, bool allowed) external onlyOwner {
        allowedDexRouters[router] = allowed;
        emit DexRouterUpdated(router, allowed);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ========================= Pay (approve) =========================

    /// @inheritdoc IPaymentRouter
    function pay(PaymentParams calldata params) external override nonReentrant whenNotPaused {
        _validatePayment(params);
        isPaid[params.invoiceId] = true;
        _executeTransfers(params, msg.sender);
    }

    // ========================= Pay with Permit =========================

    /// @inheritdoc IPaymentRouter
    function payWithPermit(
        PaymentParams calldata params,
        PermitParams calldata permit
    ) external override nonReentrant whenNotPaused {
        _validatePayment(params);
        isPaid[params.invoiceId] = true;

        // Execute permit (EIP-2612) — sets allowance without a separate tx
        try IERC20Permit(params.token).permit(
            msg.sender,
            address(this),
            permit.value,
            permit.deadline,
            permit.v,
            permit.r,
            permit.s
        ) {} catch {
            // If permit fails (e.g. already approved, or replay), continue
            // The transferFrom will fail if there's truly no allowance
        }

        _executeTransfers(params, msg.sender);
    }

    // ========================= Swap and Pay =========================

    /// @inheritdoc IPaymentRouter
    function swapAndPay(SwapParams calldata params) external override nonReentrant whenNotPaused {
        require(!isPaid[params.invoiceId], "already paid");
        require(params.merchant != address(0), "zero merchant");
        require(params.inputToken != address(0), "zero input token");
        require(params.outputToken != address(0), "zero output token");
        require(params.inputAmount > 0, "zero input");
        require(params.minOutputAmount > 0, "zero min output");
        require(params.serviceFeeBps <= MAX_SERVICE_FEE_BPS, "fee too high");
        require(block.timestamp <= params.deadline, "expired");
        require(allowedDexRouters[params.dexRouter], "dex not allowed");

        if (tokenWhitelistEnabled) {
            require(allowedTokens[params.outputToken], "output token not allowed");
        }

        isPaid[params.invoiceId] = true;

        IERC20 inputToken = IERC20(params.inputToken);
        IERC20 outputToken = IERC20(params.outputToken);

        // 1. Pull input tokens from user
        inputToken.safeTransferFrom(msg.sender, address(this), params.inputAmount);

        // 2. Approve DEX router to spend input tokens
        inputToken.forceApprove(params.dexRouter, params.inputAmount);

        // 3. Record output balance before swap
        uint256 balBefore = outputToken.balanceOf(address(this));

        // 4. Execute swap via DEX router
        (bool success, ) = params.dexRouter.call(params.dexCalldata);
        require(success, "swap failed");

        // 5. Check output
        uint256 balAfter = outputToken.balanceOf(address(this));
        uint256 outputAmount = balAfter - balBefore;
        require(outputAmount >= params.minOutputAmount, "insufficient output");

        // 6. Distribute output + return leftover input
        _distributeSwap(params, outputToken, outputAmount, inputToken);
    }

    // ========================= Internal =========================

    function _validatePayment(PaymentParams calldata params) internal view {
        require(!isPaid[params.invoiceId], "already paid");
        require(params.merchant != address(0), "zero merchant");
        require(params.token != address(0), "zero token");
        require(params.amount > 0, "zero amount");
        require(params.serviceFeeBps <= MAX_SERVICE_FEE_BPS, "fee too high");
        require(params.referrerFeeBps <= params.serviceFeeBps, "referrer > service");
        require(block.timestamp <= params.deadline, "expired");

        if (tokenWhitelistEnabled) {
            require(allowedTokens[params.token], "token not allowed");
        }
    }

    function _executeTransfers(PaymentParams calldata params, address payer) internal {
        IERC20 token = IERC20(params.token);

        uint256 serviceFee = (params.amount * params.serviceFeeBps) / BPS_DENOMINATOR;
        uint256 referrerFee = 0;
        if (params.referrer != address(0) && params.referrerFeeBps > 0) {
            referrerFee = (params.amount * params.referrerFeeBps) / BPS_DENOMINATOR;
        }
        uint256 collectorFee = serviceFee - referrerFee;
        uint256 merchantReceived = params.amount - serviceFee;

        token.safeTransferFrom(payer, params.merchant, merchantReceived);
        if (collectorFee > 0) {
            token.safeTransferFrom(payer, serviceFeeCollector, collectorFee);
        }
        if (referrerFee > 0) {
            token.safeTransferFrom(payer, params.referrer, referrerFee);
        }

        emit PaymentProcessed(
            params.invoiceId,
            payer,
            params.merchant,
            params.token,
            params.amount,
            merchantReceived,
            serviceFee,
            referrerFee
        );
    }

    function _distributeSwap(
        SwapParams calldata params,
        IERC20 outputToken,
        uint256 outputAmount,
        IERC20 inputToken
    ) internal {
        uint256 serviceFee = (outputAmount * params.serviceFeeBps) / BPS_DENOMINATOR;
        uint256 referrerFee = 0;
        if (params.referrer != address(0) && params.referrerFeeBps > 0) {
            referrerFee = (outputAmount * params.referrerFeeBps) / BPS_DENOMINATOR;
        }
        uint256 collectorFee = serviceFee - referrerFee;
        uint256 merchantReceived = outputAmount - serviceFee;

        outputToken.safeTransfer(params.merchant, merchantReceived);
        if (collectorFee > 0) {
            outputToken.safeTransfer(serviceFeeCollector, collectorFee);
        }
        if (referrerFee > 0) {
            outputToken.safeTransfer(params.referrer, referrerFee);
        }

        // Return any leftover input tokens
        uint256 leftover = inputToken.balanceOf(address(this));
        if (leftover > 0) {
            inputToken.safeTransfer(msg.sender, leftover);
        }

        emit SwapPaymentProcessed(
            params.invoiceId,
            msg.sender,
            params.merchant,
            params.inputToken,
            params.inputAmount,
            params.outputToken,
            outputAmount,
            merchantReceived,
            serviceFee
        );
    }
}
