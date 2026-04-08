// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISplitter} from "./interfaces/ISplitter.sol";

/// @title Splitter
/// @notice Splits a payment among multiple recipients according to basis points.
///         Used for white-label platforms: creator + platform + ButterPay.
contract Splitter is ISplitter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS_DENOMINATOR = 10000;

    /// @inheritdoc ISplitter
    function splitPay(
        bytes32 invoiceId,
        address token,
        uint256 totalAmount,
        Split[] calldata splits
    ) external override nonReentrant {
        require(token != address(0), "zero token");
        require(totalAmount > 0, "zero amount");
        require(splits.length > 0 && splits.length <= 10, "bad splits length");

        // Validate splits sum to 10000
        uint16 totalBps;
        for (uint256 i = 0; i < splits.length; i++) {
            require(splits[i].recipient != address(0), "zero recipient");
            require(splits[i].bps > 0, "zero bps");
            totalBps += splits[i].bps;
        }
        require(totalBps == BPS_DENOMINATOR, "bps must sum to 10000");

        IERC20 erc20 = IERC20(token);

        // Transfer from caller to each recipient
        uint256 distributed;
        for (uint256 i = 0; i < splits.length; i++) {
            uint256 share;
            if (i == splits.length - 1) {
                // Last recipient gets remainder to avoid rounding dust
                share = totalAmount - distributed;
            } else {
                share = (totalAmount * splits[i].bps) / BPS_DENOMINATOR;
            }
            distributed += share;
            erc20.safeTransferFrom(msg.sender, splits[i].recipient, share);
        }

        emit SplitPayment(invoiceId, token, totalAmount, splits.length);
    }
}
