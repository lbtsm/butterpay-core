// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IPaymentRouter {
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

    struct PermitParams {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct SwapParams {
        bytes32 invoiceId;
        address inputToken;      // token user is paying with (e.g. WETH, WBNB)
        address outputToken;     // stablecoin merchant receives (e.g. USDT)
        uint256 inputAmount;     // amount of inputToken
        uint256 minOutputAmount; // minimum stablecoin output (slippage protection)
        address merchant;
        address referrer;
        uint16 serviceFeeBps;
        uint16 referrerFeeBps;
        uint256 deadline;
        address dexRouter;       // DEX router address (1inch, uniswap, etc.)
        bytes dexCalldata;       // encoded swap calldata
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

    event SwapPaymentProcessed(
        bytes32 indexed invoiceId,
        address indexed payer,
        address indexed merchant,
        address inputToken,
        uint256 inputAmount,
        address outputToken,
        uint256 outputAmount,
        uint256 merchantReceived,
        uint256 serviceFee
    );

    event ServiceFeeCollectorUpdated(address indexed oldCollector, address indexed newCollector);
    event DexRouterUpdated(address indexed router, bool allowed);

    /// @notice Pay with pre-approved tokens (requires prior approve tx)
    function pay(PaymentParams calldata params) external;

    /// @notice Pay with EIP-2612 permit (one signature, no prior approve needed)
    function payWithPermit(PaymentParams calldata params, PermitParams calldata permit) external;

    /// @notice Swap non-stablecoin to stablecoin and pay in one atomic tx
    function swapAndPay(SwapParams calldata params) external;

    /// @notice Check if an invoice has been paid
    function isPaid(bytes32 invoiceId) external view returns (bool);
}
