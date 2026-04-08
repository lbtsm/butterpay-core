// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IPaymentReceiver} from "./interfaces/IPaymentReceiver.sol";

/// @title PaymentReceiver
/// @notice Processes single payments with service fee + optional referrer fee.
///         Non-custodial: tokens transfer directly from payer to merchant.
contract PaymentReceiver is IPaymentReceiver, Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_SERVICE_FEE_BPS = 500; // 5% hard cap
    uint16 public constant BPS_DENOMINATOR = 10000;

    /// @notice Address that collects service fees
    address public serviceFeeCollector;

    /// @notice Tracks paid invoices to prevent double-pay
    mapping(bytes32 => bool) public override isPaid;

    /// @notice Whitelisted tokens (address(0) means all tokens allowed)
    mapping(address => bool) public allowedTokens;
    bool public tokenWhitelistEnabled;

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

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ========================= Payment =========================

    /// @inheritdoc IPaymentReceiver
    function pay(PaymentParams calldata params) external override nonReentrant whenNotPaused {
        // Validations
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

        // Mark as paid before transfers (CEI pattern)
        isPaid[params.invoiceId] = true;

        IERC20 token = IERC20(params.token);

        // Calculate fees
        uint256 serviceFee = (params.amount * params.serviceFeeBps) / BPS_DENOMINATOR;
        uint256 referrerFee = 0;

        if (params.referrer != address(0) && params.referrerFeeBps > 0) {
            referrerFee = (params.amount * params.referrerFeeBps) / BPS_DENOMINATOR;
            // referrerFee is taken from serviceFee, not additional
            // serviceFee goes to collector, referrerFee goes to referrer
        }

        uint256 collectorFee = serviceFee - referrerFee;
        uint256 merchantReceived = params.amount - serviceFee;

        // Transfer: payer → merchant
        token.safeTransferFrom(msg.sender, params.merchant, merchantReceived);

        // Transfer: payer → service fee collector
        if (collectorFee > 0) {
            token.safeTransferFrom(msg.sender, serviceFeeCollector, collectorFee);
        }

        // Transfer: payer → referrer
        if (referrerFee > 0) {
            token.safeTransferFrom(msg.sender, params.referrer, referrerFee);
        }

        emit PaymentProcessed(
            params.invoiceId,
            msg.sender,
            params.merchant,
            params.token,
            params.amount,
            merchantReceived,
            serviceFee,
            referrerFee
        );
    }
}
