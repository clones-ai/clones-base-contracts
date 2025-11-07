// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAggregatorV3Interface} from "../interfaces/IAggregatorV3Interface.sol";

/**
 * @title BondingCurveImplementation
 * @notice EIP-1167 implementation for constant product bonding curve (V_ETH × V_TOK = K)
 * @dev Implements speculation-only phase with graduation at $69k market cap
 * @author CLONES
 */
contract BondingCurveImplementation is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // ----------- Custom Errors ----------- //
    error InvalidParameter(string param);
    error Unauthorized(string role);
    error SecurityViolation(string check);
    error AlreadyInitialized();
    error TradingClosed();

    // ----------- Constants ----------- //
    /// @notice Fee basis points (1% total)
    uint256 public constant TOTAL_FEE_BPS = 100; // 1.0%
    /// @notice Creator fee basis points (0.25%)
    uint256 public constant CREATOR_FEE_BPS = 25; // 0.25%
    /// @notice Protocol fee basis points (0.75%)
    uint256 public constant PROTOCOL_FEE_BPS = 75; // 0.75%
    /// @notice Graduation threshold in USD (18 decimals) - $69k
    uint256 public constant GRADUATION_THRESHOLD_USD = 69_000 * 1e18;
    /// @notice Virtual ETH offset to shape early curve (~1.3 ETH)
    uint256 public constant VIRTUAL_ETH_OFFSET = 1.3 ether;
    /// @notice Virtual token reserves (1.073B tokens with 6 decimals)
    uint256 public constant VIRTUAL_TOKEN_RESERVES = 1_073_000_000 * 10 ** 6;
    /// @notice Max slippage protection (10%)
    uint256 public constant MAX_SLIPPAGE_BPS = 1000;
    /// @notice Maximum age for price data (1 hour)
    uint256 public constant PRICE_STALENESS_THRESHOLD = 3600;

    // ----------- State Variables ----------- //
    /// @notice Dataset token contract
    IERC20 public datasetToken;
    /// @notice Dataset creator address
    address public creator;
    /// @notice Protocol fee recipient
    address public protocolFeeRecipient;
    /// @notice Factory contract address
    address public factory;
    /// @notice Graduation manager contract address
    address public graduationManager;
    /// @notice Chainlink ETH/USD price feed for graduation threshold
    IAggregatorV3Interface public ethUsdPriceFeed;
    /// @notice Current ETH reserves in the curve
    uint256 public ethReserves;
    /// @notice Current token reserves in the curve
    uint256 public tokenReserves;
    /// @notice Whether the bonding curve has graduated
    bool public isGraduated;
    /// @notice Whether this implementation has been initialized
    bool private _initialized;

    // ----------- Events ----------- //
    /// @notice Emitted when tokens are bought
    event TokensBought(
        address indexed buyer,
        uint256 ethAmount,
        uint256 tokensReceived,
        uint256 creatorFee,
        uint256 protocolFee,
        uint256 newPrice
    );
    /// @notice Emitted when tokens are sold
    event TokensSold(
        address indexed seller,
        uint256 tokensAmount,
        uint256 ethReceived,
        uint256 creatorFee,
        uint256 protocolFee,
        uint256 newPrice
    );
    /// @notice Emitted when graduation threshold is reached
    event GraduationTriggered(uint256 finalMarketCap, uint256 ethReserves, uint256 tokenReserves, uint256 timestamp);

    // ----------- Modifiers ----------- //
    modifier onlyFactory() {
        if (msg.sender != factory) revert Unauthorized("factory");
        _;
    }

    modifier onlyGraduationManager() {
        if (msg.sender != graduationManager) revert Unauthorized("graduation_manager");
        _;
    }

    modifier tradingOpen() {
        if (isGraduated) revert TradingClosed();
        _;
    }

    // ----------- Constructor ----------- //
    /// @notice Constructor disables initializers on implementation
    constructor() {
        _initialized = true; // Prevent implementation initialization
    }

    // ----------- Initialization ----------- //
    /**
     * @notice Initialize the bonding curve (called by factory)
     * @param _datasetToken Dataset token contract address
     * @param _creator Dataset creator address
     * @param _protocolFeeRecipient Protocol fee recipient address
     * @param _factory Factory contract address
     * @param _graduationManager Graduation manager contract address
     * @param _ethUsdPriceFeed Chainlink ETH/USD price feed address
     */
    function initialize(
        address _datasetToken,
        address _creator,
        address _protocolFeeRecipient,
        address _factory,
        address _graduationManager,
        address _ethUsdPriceFeed
    ) external payable {
        if (_initialized) revert AlreadyInitialized();
        if (_datasetToken == address(0)) revert InvalidParameter("dataset_token");
        if (_creator == address(0)) revert InvalidParameter("creator");
        if (_protocolFeeRecipient == address(0)) revert InvalidParameter("protocol_fee_recipient");
        if (_factory == address(0)) revert InvalidParameter("factory");
        if (_graduationManager == address(0)) revert InvalidParameter("graduation_manager");
        if (_ethUsdPriceFeed == address(0)) revert InvalidParameter("eth_usd_price_feed");
        if (msg.value < 0.02 ether) revert InvalidParameter("insufficient_liquidity");

        datasetToken = IERC20(_datasetToken);
        creator = _creator;
        protocolFeeRecipient = _protocolFeeRecipient;
        factory = _factory;
        graduationManager = _graduationManager;
        ethUsdPriceFeed = IAggregatorV3Interface(_ethUsdPriceFeed);

        // Initialize curve with liquidity contribution + virtual reserves
        ethReserves = msg.value + VIRTUAL_ETH_OFFSET;
        tokenReserves = VIRTUAL_TOKEN_RESERVES;

        _initialized = true;
    }

    // ----------- Trading Functions ----------- //
    /**
     * @notice Buy tokens with ETH using constant product formula
     * @param minTokensOut Minimum tokens to receive (slippage protection)
     * @return tokensOut Amount of tokens received
     */
    function buyTokens(uint256 minTokensOut) external payable nonReentrant tradingOpen returns (uint256 tokensOut) {
        if (msg.value == 0) revert InvalidParameter("no_eth_sent");

        // Calculate tokens out using constant product formula
        tokensOut = getTokensOut(msg.value);
        if (tokensOut < minTokensOut) revert SecurityViolation("slippage_exceeded");

        // Calculate fees
        uint256 totalFee = Math.mulDiv(msg.value, TOTAL_FEE_BPS, 10000);
        uint256 creatorFee = Math.mulDiv(totalFee, CREATOR_FEE_BPS, TOTAL_FEE_BPS);
        uint256 protocolFee = totalFee - creatorFee;
        uint256 ethAfterFees = msg.value - totalFee;

        // Update reserves
        ethReserves += ethAfterFees;
        tokenReserves -= tokensOut;

        // Transfer tokens to buyer
        datasetToken.safeTransfer(msg.sender, tokensOut);

        // Distribute fees
        if (creatorFee > 0) {
            (bool success, ) = creator.call{value: creatorFee}("");
            if (!success) revert SecurityViolation("creator_fee_transfer");
        }
        if (protocolFee > 0) {
            (bool success, ) = protocolFeeRecipient.call{value: protocolFee}("");
            if (!success) revert SecurityViolation("protocol_fee_transfer");
        }

        // Check graduation threshold using oracle
        if (_checkGraduationThreshold()) {
            _triggerGraduation();
        }

        emit TokensBought(msg.sender, msg.value, tokensOut, creatorFee, protocolFee, getCurrentPrice());
    }

    /**
     * @notice Sell tokens for ETH using constant product formula
     * @param tokensIn Amount of tokens to sell
     * @param minEthOut Minimum ETH to receive (slippage protection)
     * @return ethOut Amount of ETH received
     */
    function sellTokens(
        uint256 tokensIn,
        uint256 minEthOut
    ) external nonReentrant tradingOpen returns (uint256 ethOut) {
        if (tokensIn == 0) revert InvalidParameter("token_amount");

        // Calculate ETH out using constant product formula
        ethOut = getETHOut(tokensIn);
        if (ethOut < minEthOut) revert SecurityViolation("slippage_exceeded");

        // Calculate fees
        uint256 totalFee = Math.mulDiv(ethOut, TOTAL_FEE_BPS, 10000);
        uint256 creatorFee = Math.mulDiv(totalFee, CREATOR_FEE_BPS, TOTAL_FEE_BPS);
        uint256 protocolFee = totalFee - creatorFee;
        uint256 ethAfterFees = ethOut - totalFee;

        // Update reserves
        tokenReserves += tokensIn;
        ethReserves -= ethOut;

        // Transfer tokens from seller
        datasetToken.safeTransferFrom(msg.sender, address(this), tokensIn);

        // Transfer ETH to seller
        (bool success, ) = msg.sender.call{value: ethAfterFees}("");
        if (!success) revert SecurityViolation("eth_transfer");

        // Distribute fees
        if (creatorFee > 0) {
            (bool success2, ) = creator.call{value: creatorFee}("");
            if (!success2) revert SecurityViolation("creator_fee_transfer");
        }
        if (protocolFee > 0) {
            (bool success3, ) = protocolFeeRecipient.call{value: protocolFee}("");
            if (!success3) revert SecurityViolation("protocol_fee_transfer");
        }

        emit TokensSold(msg.sender, tokensIn, ethAfterFees, creatorFee, protocolFee, getCurrentPrice());
    }

    // ----------- Oracle Functions ----------- //
    /**
     * @notice Check if graduation threshold has been reached using oracle
     * @return hasReachedThreshold Whether the $69k USD threshold has been reached
     */
    function _checkGraduationThreshold() internal view returns (bool hasReachedThreshold) {
        try this._getGraduationThresholdETH() returns (uint256 thresholdETH) {
            return ethReserves >= thresholdETH;
        } catch {
            // Oracle failed, use fallback (assume not reached to be conservative)
            return false;
        }
    }

    /**
     * @notice Get graduation threshold in ETH using oracle (external call for try/catch)
     * @return thresholdETH Graduation threshold in ETH based on current USD price
     */
    function _getGraduationThresholdETH() external view returns (uint256 thresholdETH) {
        (, int256 ethPrice, , uint256 updatedAt, ) = ethUsdPriceFeed.latestRoundData();

        // Validate price data
        if (ethPrice <= 0) revert SecurityViolation("invalid_eth_price");
        if (block.timestamp - updatedAt > PRICE_STALENESS_THRESHOLD) {
            revert SecurityViolation("stale_eth_price");
        }

        // Convert price to 18 decimals (Chainlink typically uses 8 decimals)
        uint8 priceFeedDecimals = ethUsdPriceFeed.decimals();
        uint256 ethPriceUSD = uint256(ethPrice) * (10 ** (18 - priceFeedDecimals));

        // Calculate ETH amount for GRADUATION_THRESHOLD_USD
        // $69k USD / ETH price = threshold in ETH
        thresholdETH = Math.mulDiv(GRADUATION_THRESHOLD_USD, 1e18, ethPriceUSD);
    }

    /**
     * @notice Get current graduation threshold in ETH (public view)
     * @return thresholdETH Current threshold in ETH, or 0 if oracle fails
     */
    function getCurrentGraduationThreshold() external view returns (uint256 thresholdETH) {
        try this._getGraduationThresholdETH() returns (uint256 threshold) {
            return threshold;
        } catch {
            return 0; // Oracle failed
        }
    }

    // ----------- Graduation Logic ----------- //
    /**
     * @notice Trigger graduation when threshold is reached
     * @dev Internal function called when USD threshold is reached via oracle
     */
    function _triggerGraduation() internal {
        isGraduated = true;

        uint256 marketCap = getCurrentMarketCapUSD();

        emit GraduationTriggered(marketCap, ethReserves, tokenReserves, block.timestamp);
    }

    /**
     * @notice Finalize graduation and transfer assets to graduation manager
     * @dev Called by graduation manager to claim assets for Uniswap V2 migration
     */
    function finalizeGraduation() external onlyGraduationManager nonReentrant {
        if (!isGraduated) revert SecurityViolation("not_graduated");

        uint256 ethBalance = address(this).balance;
        uint256 tokenBalance = datasetToken.balanceOf(address(this));

        // Transfer all assets to graduation manager
        if (ethBalance > 0) {
            (bool success, ) = graduationManager.call{value: ethBalance}("");
            if (!success) revert SecurityViolation("eth_transfer");
        }

        if (tokenBalance > 0) {
            datasetToken.safeTransfer(graduationManager, tokenBalance);
        }
    }

    // ----------- View Functions ----------- //
    /**
     * @notice Get current token price in ETH
     * @return price Price in ETH per token (18 decimals)
     */
    function getCurrentPrice() public view returns (uint256 price) {
        if (tokenReserves == 0) return 0;
        return Math.mulDiv(ethReserves, 1e18, tokenReserves);
    }

    /**
     * @notice Get current market cap in ETH
     * @return marketCap Total market cap in ETH
     */
    function getCurrentMarketCap() public view returns (uint256 marketCap) {
        uint256 price = getCurrentPrice();
        uint256 totalSupply = 1_000_000_000 * 10 ** 6; // 1B tokens with 6 decimals
        return Math.mulDiv(totalSupply, price, 1e18);
    }

    /**
     * @notice Get current market cap in USD using oracle
     * @return marketCapUSD Total market cap in USD (18 decimals)
     */
    function getCurrentMarketCapUSD() public view returns (uint256 marketCapUSD) {
        try this._getMarketCapUSD() returns (uint256 marketCap) {
            return marketCap;
        } catch {
            return 0; // Oracle failed
        }
    }

    /**
     * @notice Get market cap in USD using oracle (external call for try/catch)
     * @return marketCapUSD Market cap in USD
     */
    function _getMarketCapUSD() external view returns (uint256 marketCapUSD) {
        (, int256 ethPrice, , uint256 updatedAt, ) = ethUsdPriceFeed.latestRoundData();

        // Validate price data
        if (ethPrice <= 0) revert SecurityViolation("invalid_eth_price");
        if (block.timestamp - updatedAt > PRICE_STALENESS_THRESHOLD) {
            revert SecurityViolation("stale_eth_price");
        }

        // Convert price to 18 decimals
        uint8 priceFeedDecimals = ethUsdPriceFeed.decimals();
        uint256 ethPriceUSD = uint256(ethPrice) * (10 ** (18 - priceFeedDecimals));

        // Get market cap in ETH and convert to USD
        uint256 marketCapETH = getCurrentMarketCap();
        marketCapUSD = Math.mulDiv(marketCapETH, ethPriceUSD, 1e18);
    }

    /**
     * @notice Calculate tokens received for ETH input
     * @param ethIn Amount of ETH to spend
     * @return tokensOut Amount of tokens received
     */
    function getTokensOut(uint256 ethIn) public view returns (uint256 tokensOut) {
        if (ethIn == 0) return 0;

        uint256 totalFee = Math.mulDiv(ethIn, TOTAL_FEE_BPS, 10000);
        uint256 ethAfterFees = ethIn - totalFee;

        // Constant product: (ethReserves + ethAfterFees) * (tokenReserves - tokensOut) = K
        // tokensOut = tokenReserves - (K / (ethReserves + ethAfterFees))
        uint256 k = ethReserves * tokenReserves;
        uint256 newEthReserves = ethReserves + ethAfterFees;
        uint256 newTokenReserves = k / newEthReserves;

        tokensOut = tokenReserves - newTokenReserves;
    }

    /**
     * @notice Calculate ETH received for token input
     * @param tokensIn Amount of tokens to sell
     * @return ethOut Amount of ETH received (before fees)
     */
    function getETHOut(uint256 tokensIn) public view returns (uint256 ethOut) {
        if (tokensIn == 0) return 0;

        // Constant product: (ethReserves - ethOut) * (tokenReserves + tokensIn) = K
        // ethOut = ethReserves - (K / (tokenReserves + tokensIn))
        uint256 k = ethReserves * tokenReserves;
        uint256 newTokenReserves = tokenReserves + tokensIn;
        uint256 newEthReserves = k / newTokenReserves;

        ethOut = ethReserves - newEthReserves;
    }

    /**
     * @notice Get bonding curve state
     * @return ethReserves_ Current ETH reserves
     * @return tokenReserves_ Current token reserves
     * @return isGraduated_ Whether curve has graduated
     * @return marketCap_ Current market cap in ETH
     */
    function getCurveState()
        external
        view
        returns (uint256 ethReserves_, uint256 tokenReserves_, bool isGraduated_, uint256 marketCap_)
    {
        return (ethReserves, tokenReserves, isGraduated, getCurrentMarketCap());
    }

    /**
     * @notice Check if this contract is initialized
     * @return Whether the contract has been initialized
     */
    function initialized() external view returns (bool) {
        return _initialized;
    }

    // ----------- Emergency Functions ----------- //
    /**
     * @notice Emergency ETH withdrawal (factory only)
     * @dev Only callable in emergency situations by factory
     */
    function emergencyWithdrawETH() external onlyFactory {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool success, ) = factory.call{value: balance}("");
            if (!success) revert SecurityViolation("emergency_withdrawal");
        }
    }

    /// @notice Receive ETH for liquidity contributions
    receive() external payable {
        // Accept ETH for liquidity contributions during initialization
    }
}
