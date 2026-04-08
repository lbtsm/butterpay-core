// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IPaymentReceiver {
    struct PaymentParams {
        bytes32 invoiceId;       // unique invoice identifier
        address token;           // ERC20 token address (USDT/USDC)
        uint256 amount;          // total payment amount (including service fee)
        address merchant;        // merchant receiving address
        address referrer;        // referrer address (address(0) if none)
        uint16 serviceFeeBps;   // service fee in basis points (50 = 0.5%, 80 = 0.8%)
        uint16 referrerFeeBps;  // referrer fee from service fee in bps (20 = 0.2%)
        uint256 deadline;        // payment expiry timestamp
    }

    event PaymentProcessed(
        bytes32 indexed invoiceId,
        address indexed payer,
        address indexed merchant,
        address token,
        uint256 amount,
        uint256 merchantReceived,
        uint256 serviceFee,
        uint256 referrerFee
    );

    event ServiceFeeCollectorUpdated(address indexed oldCollector, address indexed newCollector);

    /// @notice Process a single payment
    function pay(PaymentParams calldata params) external;

    /// @notice Check if an invoice has been paid
    function isPaid(bytes32 invoiceId) external view returns (bool);
}
