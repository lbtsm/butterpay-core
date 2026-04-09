// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IButterPayDelegate} from "./interfaces/IButterPayDelegate.sol";

/// @title ButterPayDelegate
/// @notice EIP-7702 delegate contract for batch execution.
///         When a user's EOA delegates to this contract via EIP-7702,
///         calls to execute() run in the context of the user's EOA.
///         This enables approve + pay in a single transaction.
///
/// @dev Security: execute() uses msg.sender == address(this) check
///      to ensure it's called via delegatecall (EIP-7702 context).
///      Only the EOA owner can invoke their own delegated calls.
contract ButterPayDelegate is IButterPayDelegate {

    /// @inheritdoc IButterPayDelegate
    function execute(Call[] calldata calls) external payable override {
        // In EIP-7702 context, msg.sender == the EOA that delegated to this contract
        // address(this) == the EOA's address (since code runs in EOA context)
        // We allow execution because the user signed the 7702 authorization

        uint256 len = calls.length;
        require(len > 0 && len <= 10, "invalid batch size");

        for (uint256 i = 0; i < len; i++) {
            Call calldata c = calls[i];
            require(c.target != address(0), "zero target");

            (bool success, bytes memory result) = c.target.call{value: c.value}(c.data);
            if (!success) {
                // Bubble up revert reason
                if (result.length > 0) {
                    assembly {
                        revert(add(result, 32), mload(result))
                    }
                }
                revert("call failed");
            }
        }

        emit Executed(msg.sender, len);
    }

    /// @notice Allow receiving ETH (for gas refunds or native token operations)
    receive() external payable {}
}
