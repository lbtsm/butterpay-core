// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ISplitter {
    struct Split {
        address recipient;
        uint16 bps; // basis points (10000 = 100%)
    }

    event SplitPayment(
        bytes32 indexed invoiceId,
        address indexed token,
        uint256 totalAmount,
        uint256 numRecipients
    );

    /// @notice Execute a split payment
    /// @param invoiceId Unique invoice identifier
    /// @param token ERC20 token address
    /// @param totalAmount Total amount to split (after service fee)
    /// @param splits Array of (recipient, bps) pairs, must sum to 10000
    function splitPay(
        bytes32 invoiceId,
        address token,
        uint256 totalAmount,
        Split[] calldata splits
    ) external;
}
