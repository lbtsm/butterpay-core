// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
}

/// @dev Mock DEX router that "swaps" by burning input and minting output at 1:1 rate
contract MockDexRouter {
    function swap(
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 /* minOutput */,
        address recipient
    ) external {
        IERC20(inputToken).transferFrom(msg.sender, address(this), inputAmount);
        // Simulate swap: mint outputToken to recipient (1:1 for simplicity)
        IMintable(outputToken).mint(recipient, inputAmount);
    }
}
