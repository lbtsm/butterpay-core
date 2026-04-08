// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ISubscriptionManager {
    struct SubscriptionPlan {
        address merchant;       // merchant receiving address
        address token;          // ERC20 token
        uint256 amount;         // charge amount per interval
        uint32 interval;        // charge interval in seconds (e.g. 30 days)
        uint32 expiry;          // subscription expiry timestamp (0 = no expiry)
    }

    struct Subscription {
        address subscriber;
        address merchant;
        address token;
        uint256 amount;
        uint32 interval;
        uint32 expiry;
        uint32 lastCharged;
        bool active;
    }

    event SubscriptionCreated(
        uint256 indexed subscriptionId,
        address indexed subscriber,
        address indexed merchant,
        address token,
        uint256 amount,
        uint32 interval
    );

    event SubscriptionCharged(
        uint256 indexed subscriptionId,
        address indexed subscriber,
        address indexed merchant,
        uint256 amount
    );

    event SubscriptionCancelled(uint256 indexed subscriptionId, address indexed subscriber);

    /// @notice Create a subscription and execute first charge
    function subscribe(SubscriptionPlan calldata plan) external returns (uint256 subscriptionId);

    /// @notice Charge a subscription (called by scheduler/relayer)
    function charge(uint256 subscriptionId) external;

    /// @notice Cancel a subscription (only subscriber)
    function cancel(uint256 subscriptionId) external;

    /// @notice Get subscription details
    function getSubscription(uint256 subscriptionId) external view returns (Subscription memory);
}
