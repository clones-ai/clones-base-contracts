// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {DatasetToken} from "./DatasetToken.sol";

/**
 * @title BondingCurve
 * @author Clones Protocol
 * @notice Implements constant product bonding curve (V_ETH × V_TOK = K)
 * @dev Phase 1 trading until $69k market cap graduation
 */
contract BondingCurve is ReentrancyGuard {
    // Custom errors for gas optimization
    error InvalidToken();
    error InvalidCreator();
    error InvalidFeeRecipient();
    error NeedInitialLiquidity();
    error TradingNotActive();
    error NoETHSent();
    error NoTokensToSell();
    error SlippageExceeded();
    error InsufficientLiquidity();
    error InsufficientETH();
    error FeeTransferFailed();
    error ETHTransferFailed();
    error TokenTransferFailed();
    error OnlyGraduationManager();
    error NotGraduated();
    error AlreadyGraduated();
    /// @notice Dataset token being traded
    DatasetToken public immutable DATASET_TOKEN;

    /// @notice Dataset creator address (receives 0.25% fees)
    address public immutable CREATOR;

    /// @notice Protocol fee recipient (receives 0.75% fees)
    address public immutable PROTOCOL_FEE_RECIPIENT;

    /// @notice Graduation manager address
    address public immutable GRADUATION_MANAGER;

    /// @notice Virtual ETH reserves (~1.3 ETH)
    uint256 public virtualETH;

    /// @notice Virtual token reserves (1,073,000,000 tokens)
    uint256 public virtualTokens;

    /// @notice Constant product K
    uint256 public immutable INVARIANT_K;

    /// @notice Real ETH balance raised
    uint256 public ethRaised;

    /// @notice Real tokens sold
    uint256 public tokensSold;

    /// @notice Graduation target (~$69,000 market cap)
    uint256 public constant GRADUATION_TARGET = 23 ether; // ~$69k at $3k/ETH

    /// @notice Trading fees (1% total = 100 basis points)
    uint256 public constant TOTAL_FEE = 100; // 1.00%
    /// @notice Creator fee (0.25%)
    uint256 public constant CREATOR_FEE = 25; // 0.25%
    /// @notice Protocol fee (0.75%)
    uint256 public constant PROTOCOL_FEE = 75; // 0.75%
    /// @notice Fee denominator for basis points calculation
    uint256 public constant FEE_DENOMINATOR = 10000;

    /// @notice Whether trading is active
    bool public isActive;

    /// @notice Whether graduated to Uniswap
    bool public hasGraduated;

    /// @notice Emitted on token purchase
    /// @param buyer Address that bought tokens
    /// @param ethAmount Amount of ETH spent
    /// @param tokenAmount Amount of tokens received
    /// @param price Current token price
    /// @param timestamp Block timestamp
    event Buy(
        address indexed buyer,
        uint256 indexed ethAmount,
        uint256 indexed tokenAmount,
        uint256 price,
        uint256 timestamp
    );

    /// @notice Emitted on token sale
    /// @param seller Address that sold tokens
    /// @param tokenAmount Amount of tokens sold
    /// @param ethAmount Amount of ETH received
    /// @param price Current token price
    /// @param timestamp Block timestamp
    event Sell(
        address indexed seller,
        uint256 indexed tokenAmount,
        uint256 indexed ethAmount,
        uint256 price,
        uint256 timestamp
    );

    /// @notice Emitted when graduation target is reached
    /// @param ethRaised Total ETH raised at graduation
    /// @param tokensSold Total tokens sold at graduation
    /// @param timestamp Block timestamp
    event GraduationReached(uint256 indexed ethRaised, uint256 indexed tokensSold, uint256 indexed timestamp);

    /// @notice Initializes bonding curve with virtual reserves
    /// @param _datasetToken Address of the dataset token
    /// @param _creator Address of the dataset creator (fee recipient)
    /// @param _protocolFeeRecipient Address for protocol fees
    /// @param _graduationManager Address that manages graduation to Uniswap
    constructor(
        address _datasetToken,
        address _creator,
        address _protocolFeeRecipient,
        address _graduationManager
    ) payable {
        if (_datasetToken == address(0)) revert InvalidToken();
        if (_creator == address(0)) revert InvalidCreator();
        if (_protocolFeeRecipient == address(0)) revert InvalidFeeRecipient();
        if (msg.value == 0) revert NeedInitialLiquidity();

        DATASET_TOKEN = DatasetToken(_datasetToken);
        CREATOR = _creator;
        PROTOCOL_FEE_RECIPIENT = _protocolFeeRecipient;
        GRADUATION_MANAGER = _graduationManager;

        // Initialize virtual reserves
        virtualETH = 1.3 ether + msg.value;
        virtualTokens = 1_073_000_000 * 10 ** 6; // 1.073B tokens (6 decimals)
        INVARIANT_K = virtualETH * virtualTokens;

        isActive = true;
    }

    /**
     * @notice Buy tokens with ETH
     * @param minTokensOut Minimum tokens to receive (slippage protection)
     * @return tokensOut Amount of tokens received
     */
    function buy(uint256 minTokensOut) external payable nonReentrant returns (uint256 tokensOut) {
        if (!isActive || hasGraduated) revert TradingNotActive();
        if (msg.value == 0) revert NoETHSent();

        // Calculate fees
        uint256 feeAmount = (msg.value * TOTAL_FEE) / FEE_DENOMINATOR;
        uint256 ethAfterFee = msg.value - feeAmount;

        // Distribute fees
        uint256 creatorFee = (feeAmount * CREATOR_FEE) / TOTAL_FEE;
        uint256 protocolFee = feeAmount - creatorFee;

        (bool success1, ) = CREATOR.call{value: creatorFee}("");
        (bool success2, ) = PROTOCOL_FEE_RECIPIENT.call{value: protocolFee}("");
        if (!success1 || !success2) revert FeeTransferFailed();

        // Calculate tokens out using bonding curve
        uint256 newVirtualETH = virtualETH + ethAfterFee;
        uint256 newVirtualTokens = INVARIANT_K / newVirtualETH;
        tokensOut = virtualTokens - newVirtualTokens;

        if (tokensOut < minTokensOut) revert SlippageExceeded();
        if (tokensOut > DATASET_TOKEN.balanceOf(address(this))) revert InsufficientLiquidity();

        // Update state
        virtualETH = newVirtualETH;
        virtualTokens = newVirtualTokens;
        ethRaised += ethAfterFee;
        tokensSold += tokensOut;

        // Transfer tokens
        if (!DATASET_TOKEN.transfer(msg.sender, tokensOut)) {
            revert TokenTransferFailed();
        }

        emit Buy(msg.sender, msg.value, tokensOut, getCurrentPrice(), block.timestamp);

        // Check for graduation
        if (ethRaised >= GRADUATION_TARGET) {
            _triggerGraduation();
        }

        return tokensOut;
    }

    /**
     * @notice Sell tokens for ETH
     * @param tokenAmount Amount of tokens to sell
     * @param minEthOut Minimum ETH to receive (slippage protection)
     * @return ethOut Amount of ETH received
     */
    function sell(uint256 tokenAmount, uint256 minEthOut) external nonReentrant returns (uint256 ethOut) {
        if (!isActive || hasGraduated) revert TradingNotActive();
        if (tokenAmount == 0) revert NoTokensToSell();

        // Transfer tokens from seller
        if (!DATASET_TOKEN.transferFrom(msg.sender, address(this), tokenAmount)) {
            revert TokenTransferFailed();
        }

        // Calculate ETH out using bonding curve
        uint256 newVirtualTokens = virtualTokens + tokenAmount;
        uint256 newVirtualETH = INVARIANT_K / newVirtualTokens;
        uint256 ethBeforeFee = virtualETH - newVirtualETH;

        // Calculate fees
        uint256 feeAmount = (ethBeforeFee * TOTAL_FEE) / FEE_DENOMINATOR;
        ethOut = ethBeforeFee - feeAmount;

        if (ethOut < minEthOut) revert SlippageExceeded();
        if (ethOut > address(this).balance) revert InsufficientETH();

        // Distribute fees
        uint256 creatorFee = (feeAmount * CREATOR_FEE) / TOTAL_FEE;
        uint256 protocolFee = feeAmount - creatorFee;

        (bool success1, ) = CREATOR.call{value: creatorFee}("");
        (bool success2, ) = PROTOCOL_FEE_RECIPIENT.call{value: protocolFee}("");
        if (!success1 || !success2) revert FeeTransferFailed();

        // Update state
        virtualETH = newVirtualETH;
        virtualTokens = newVirtualTokens;

        // Transfer ETH to seller
        (bool success, ) = msg.sender.call{value: ethOut}("");
        if (!success) revert ETHTransferFailed();

        emit Sell(msg.sender, tokenAmount, ethOut, getCurrentPrice(), block.timestamp);

        return ethOut;
    }

    /**
     * @notice Get current token price in ETH
     * @return Current price per token
     */
    function getCurrentPrice() public view returns (uint256) {
        return (virtualETH * 10 ** 18) / virtualTokens;
    }

    /**
     * @notice Calculate tokens out for given ETH in
     * @param ethIn Amount of ETH to spend
     * @return tokensOut Estimated tokens to receive (before fees)
     */
    function getTokensOut(uint256 ethIn) external view returns (uint256 tokensOut) {
        uint256 feeAmount = (ethIn * TOTAL_FEE) / FEE_DENOMINATOR;
        uint256 ethAfterFee = ethIn - feeAmount;

        uint256 newVirtualETH = virtualETH + ethAfterFee;
        uint256 newVirtualTokens = INVARIANT_K / newVirtualETH;
        tokensOut = virtualTokens - newVirtualTokens;

        return tokensOut;
    }

    /**
     * @notice Calculate ETH out for given tokens in
     * @param tokensIn Amount of tokens to sell
     * @return ethOut Estimated ETH to receive (before fees)
     */
    function getETHOut(uint256 tokensIn) external view returns (uint256 ethOut) {
        uint256 newVirtualTokens = virtualTokens + tokensIn;
        uint256 newVirtualETH = INVARIANT_K / newVirtualTokens;
        uint256 ethBeforeFee = virtualETH - newVirtualETH;

        uint256 feeAmount = (ethBeforeFee * TOTAL_FEE) / FEE_DENOMINATOR;
        ethOut = ethBeforeFee - feeAmount;

        return ethOut;
    }

    /**
     * @notice Trigger graduation to Uniswap (internal)
     */
    function _triggerGraduation() internal {
        if (hasGraduated) revert AlreadyGraduated();

        isActive = false;
        hasGraduated = true;

        emit GraduationReached(ethRaised, tokensSold, block.timestamp);

        // Graduation manager will handle Uniswap V2 migration
    }

    /**
     * @notice Finalize graduation (called by graduation manager)
     */
    function finalizeGraduation() external {
        if (msg.sender != GRADUATION_MANAGER) revert OnlyGraduationManager();
        if (!hasGraduated) revert NotGraduated();

        // Transfer all remaining ETH and tokens to graduation manager
        uint256 ethBalance = address(this).balance;
        uint256 tokenBalance = DATASET_TOKEN.balanceOf(address(this));

        if (ethBalance > 0) {
            (bool success, ) = GRADUATION_MANAGER.call{value: ethBalance}("");
            if (!success) revert ETHTransferFailed();
        }

        if (tokenBalance > 0) {
            if (!DATASET_TOKEN.transfer(GRADUATION_MANAGER, tokenBalance)) {
                revert TokenTransferFailed();
            }
        }
    }
}
