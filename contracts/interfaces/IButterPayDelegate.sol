// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IButterPayDelegate {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    event Executed(address indexed sender, uint256 numCalls);

    /// @notice Execute a batch of calls atomically.
    ///         Designed for EIP-7702: user delegates EOA to this contract,
    ///         then calls execute([approve, pay]) in one transaction.
    function execute(Call[] calldata calls) external payable;
}
