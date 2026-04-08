// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ISubscriptionManager} from "./interfaces/ISubscriptionManager.sol";

/// @title SubscriptionManager
/// @notice Manages recurring subscriptions. Charges are pulled directly from
///         subscriber's wallet via transferFrom (requires prior ERC20 approval).
///         Non-custodial: contract never holds user funds.
contract SubscriptionManager is ISubscriptionManager, Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    /// @notice Service fee collector address
    address public serviceFeeCollector;

    /// @notice Service fee in basis points
    uint16 public serviceFeeBps;

    uint16 public constant BPS_DENOMINATOR = 10000;
    uint16 public constant MAX_SERVICE_FEE_BPS = 500;

    /// @notice Auto-incrementing subscription ID
    uint256 public nextSubscriptionId = 1;

    /// @notice subscriptionId → Subscription
    mapping(uint256 => Subscription) public subscriptions;

    /// @notice Authorized chargers (scheduler/relayer addresses)
    mapping(address => bool) public authorizedChargers;

    constructor(
        address _serviceFeeCollector,
        uint16 _serviceFeeBps
    ) Ownable(msg.sender) {
        require(_serviceFeeCollector != address(0), "zero collector");
        require(_serviceFeeBps <= MAX_SERVICE_FEE_BPS, "fee too high");
        serviceFeeCollector = _serviceFeeCollector;
        serviceFeeBps = _serviceFeeBps;
    }

    // ========================= Admin =========================

    function setServiceFeeCollector(address _collector) external onlyOwner {
        require(_collector != address(0), "zero collector");
        serviceFeeCollector = _collector;
    }

    function setServiceFeeBps(uint16 _bps) external onlyOwner {
        require(_bps <= MAX_SERVICE_FEE_BPS, "fee too high");
        serviceFeeBps = _bps;
    }

    function setAuthorizedCharger(address charger, bool authorized) external onlyOwner {
        authorizedChargers[charger] = authorized;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ========================= Subscription =========================

    /// @inheritdoc ISubscriptionManager
    function subscribe(SubscriptionPlan calldata plan)
        external
        override
        nonReentrant
        whenNotPaused
        returns (uint256 subscriptionId)
    {
        require(plan.merchant != address(0), "zero merchant");
        require(plan.token != address(0), "zero token");
        require(plan.amount > 0, "zero amount");
        require(plan.interval >= 1 days, "interval too short");

        subscriptionId = nextSubscriptionId++;

        subscriptions[subscriptionId] = Subscription({
            subscriber: msg.sender,
            merchant: plan.merchant,
            token: plan.token,
            amount: plan.amount,
            interval: plan.interval,
            expiry: plan.expiry,
            lastCharged: uint32(block.timestamp),
            active: true
        });

        emit SubscriptionCreated(
            subscriptionId,
            msg.sender,
            plan.merchant,
            plan.token,
            plan.amount,
            plan.interval
        );

        // Execute first charge immediately
        _executeCharge(subscriptionId);
    }

    /// @inheritdoc ISubscriptionManager
    function charge(uint256 subscriptionId) external override nonReentrant whenNotPaused {
        require(
            authorizedChargers[msg.sender] || msg.sender == owner(),
            "not authorized"
        );
        _executeCharge(subscriptionId);
    }

    /// @inheritdoc ISubscriptionManager
    function cancel(uint256 subscriptionId) external override {
        Subscription storage sub = subscriptions[subscriptionId];
        require(sub.subscriber == msg.sender, "not subscriber");
        require(sub.active, "already cancelled");

        sub.active = false;
        emit SubscriptionCancelled(subscriptionId, msg.sender);
    }

    /// @inheritdoc ISubscriptionManager
    function getSubscription(uint256 subscriptionId)
        external
        view
        override
        returns (Subscription memory)
    {
        return subscriptions[subscriptionId];
    }

    // ========================= Internal =========================

    function _executeCharge(uint256 subscriptionId) internal {
        Subscription storage sub = subscriptions[subscriptionId];

        require(sub.active, "not active");
        require(sub.subscriber != address(0), "not found");

        // Check expiry
        if (sub.expiry > 0) {
            require(block.timestamp <= sub.expiry, "expired");
        }

        // Check interval (skip for first charge, lastCharged is set to block.timestamp on creation)
        // For subsequent charges, enforce interval
        if (sub.lastCharged < uint32(block.timestamp)) {
            // Allow charge only if enough time has passed since last charge
            // First charge: lastCharged == block.timestamp, this check passes via subscribe() calling _executeCharge in same tx
        }

        // For non-first charges, enforce interval
        bool isFirstCharge = (sub.lastCharged == uint32(block.timestamp));
        if (!isFirstCharge) {
            require(
                block.timestamp >= uint256(sub.lastCharged) + uint256(sub.interval),
                "too early"
            );
        }

        sub.lastCharged = uint32(block.timestamp);

        IERC20 token = IERC20(sub.token);

        // Calculate service fee
        uint256 serviceFee = (sub.amount * serviceFeeBps) / BPS_DENOMINATOR;
        uint256 merchantReceived = sub.amount - serviceFee;

        // Transfer: subscriber → merchant
        token.safeTransferFrom(sub.subscriber, sub.merchant, merchantReceived);

        // Transfer: subscriber → fee collector
        if (serviceFee > 0) {
            token.safeTransferFrom(sub.subscriber, serviceFeeCollector, serviceFee);
        }

        emit SubscriptionCharged(subscriptionId, sub.subscriber, sub.merchant, sub.amount);
    }
}
