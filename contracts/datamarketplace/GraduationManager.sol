// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title GraduationManager
 * @notice Manages graduation from bonding curve to Uniswap V2 with permanent liquidity
 * @dev Creates Uniswap V2 LP pair and burns all LP tokens to 0xdead for permanent liquidity
 * @author CLONES
 */
contract GraduationManager is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ----------- Custom Errors ----------- //
    error InvalidParameter(string param);
    error Unauthorized(string role);
    error SecurityViolation(string check);
    error GraduationFailed(string reason);

    // ----------- Constants ----------- //
    /// @notice Role identifier for timelock operations
    bytes32 public constant TIMELOCK_ROLE = keccak256("TIMELOCK_ROLE");
    /// @notice Role identifier for emergency operations
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    /// @notice Dead address for burning LP tokens (permanent liquidity)
    address private constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // ----------- Immutable State ----------- //
    /// @notice Uniswap V2 Factory address
    address public immutable UNISWAP_V2_FACTORY;
    /// @notice Uniswap V2 Router address
    address public immutable UNISWAP_V2_ROUTER;
    /// @notice WETH address on Base network
    address public immutable WETH;
    /// @notice Timelock contract address
    address public immutable TIMELOCK;
    /// @notice Guardian address for emergency operations
    address public immutable GUARDIAN;

    // ----------- State Variables ----------- //
    /// @notice Dataset factory contract address
    address public datasetFactory;
    /// @notice Burn portal contract address
    address public burnPortal;

    // ----------- Graduation Tracking ----------- //
    /// @notice Mapping of dataset token => graduation info
    mapping(address => GraduationInfo) public graduationInfo;

    // ----------- Structs ----------- //
    struct GraduationInfo {
        address lpPair; // Uniswap V2 LP pair address
        uint256 graduationTime; // Block timestamp of graduation
        uint256 ethContributed; // Amount of ETH added to LP
        uint256 tokensContributed; // Amount of tokens added to LP
        bool isGraduated; // Whether dataset has graduated
    }

    // ----------- Events ----------- //
    /// @notice Emitted when a dataset graduates to Uniswap V2
    event DatasetGraduated(
        address indexed datasetToken,
        address indexed bondingCurve,
        address indexed lpPair,
        uint256 ethContributed,
        uint256 tokensContributed,
        uint256 lpTokensBurned,
        uint256 timestamp
    );
    /// @notice Emitted when burn portal is activated for a dataset
    event BurnPortalActivated(address indexed datasetToken, address indexed burnPortal, uint256 timestamp);
    /// @notice Emitted when dataset factory is updated
    event DatasetFactoryUpdated(address indexed oldFactory, address indexed newFactory);
    /// @notice Emitted when burn portal is updated
    event BurnPortalUpdated(address indexed oldPortal, address indexed newPortal);

    // ----------- Modifiers ----------- //
    modifier onlyTimelock() {
        if (msg.sender != TIMELOCK) revert Unauthorized("timelock");
        _;
    }

    modifier onlyGuardian() {
        if (msg.sender != GUARDIAN) revert Unauthorized("guardian");
        _;
    }

    modifier onlyDatasetFactory() {
        if (msg.sender != datasetFactory) revert Unauthorized("dataset_factory");
        _;
    }

    // ----------- Constructor ----------- //
    /// @notice Initialize the GraduationManager
    /// @param _uniswapV2Factory Uniswap V2 Factory address
    /// @param _uniswapV2Router Uniswap V2 Router address
    /// @param _weth WETH address on Base network
    /// @param _timelock Timelock contract address
    /// @param _guardian Guardian address
    constructor(
        address _uniswapV2Factory,
        address _uniswapV2Router,
        address _weth,
        address _timelock,
        address _guardian
    ) {
        if (_uniswapV2Factory == address(0)) revert InvalidParameter("uniswap_factory");
        if (_uniswapV2Router == address(0)) revert InvalidParameter("uniswap_router");
        if (_weth == address(0)) revert InvalidParameter("weth");
        if (_timelock == address(0)) revert InvalidParameter("timelock");
        if (_guardian == address(0)) revert InvalidParameter("guardian");

        UNISWAP_V2_FACTORY = _uniswapV2Factory;
        UNISWAP_V2_ROUTER = _uniswapV2Router;
        WETH = _weth;
        TIMELOCK = _timelock;
        GUARDIAN = _guardian;

        _grantRole(DEFAULT_ADMIN_ROLE, _timelock);
        _grantRole(TIMELOCK_ROLE, _timelock);
        _grantRole(EMERGENCY_ROLE, _guardian);
    }

    // ----------- Graduation Logic ----------- //
    /**
     * @notice Graduate a dataset from bonding curve to Uniswap V2
     * @dev Called when bonding curve reaches graduation threshold
     * @param datasetToken Dataset token address
     * @param bondingCurve Bonding curve address
     * @return lpPair Address of created Uniswap V2 LP pair
     */
    function graduateDataset(
        address datasetToken,
        address bondingCurve
    ) external onlyDatasetFactory nonReentrant returns (address lpPair) {
        if (datasetToken == address(0)) revert InvalidParameter("dataset_token");
        if (bondingCurve == address(0)) revert InvalidParameter("bonding_curve");
        if (graduationInfo[datasetToken].isGraduated) {
            revert GraduationFailed("already_graduated");
        }

        // Finalize bonding curve to claim assets
        IBondingCurve(bondingCurve).finalizeGraduation();

        // Get balances received from bonding curve
        uint256 ethBalance = address(this).balance;
        uint256 tokenBalance = IERC20(datasetToken).balanceOf(address(this));

        if (ethBalance == 0 || tokenBalance == 0) {
            revert GraduationFailed("insufficient_assets");
        }

        // Graduate the dataset token (transfers LP supply to this contract)
        IDatasetToken(datasetToken).graduate();

        // Get final token balance after graduation (should include LP supply)
        uint256 finalTokenBalance = IERC20(datasetToken).balanceOf(address(this));

        // Create Uniswap V2 LP pair
        lpPair = _createUniswapV2Pair(datasetToken, ethBalance, finalTokenBalance);

        // Burn all LP tokens to dead address for permanent liquidity
        uint256 lpTokensBurned = _burnLPTokens(lpPair);

        // Store graduation info
        graduationInfo[datasetToken] = GraduationInfo({
            lpPair: lpPair,
            graduationTime: block.timestamp,
            ethContributed: ethBalance,
            tokensContributed: finalTokenBalance,
            isGraduated: true
        });


        // Activate burn portal if available
        if (burnPortal != address(0)) {
            IBurnPortal(burnPortal).activateDataset(datasetToken);
            emit BurnPortalActivated(datasetToken, burnPortal, block.timestamp);
        }

        emit DatasetGraduated(
            datasetToken,
            bondingCurve,
            lpPair,
            ethBalance,
            finalTokenBalance,
            lpTokensBurned,
            block.timestamp
        );

        return lpPair;
    }

    /**
     * @notice Create Uniswap V2 LP pair and add liquidity
     * @param datasetToken Dataset token address
     * @param ethAmount Amount of ETH to add
     * @param tokenAmount Amount of tokens to add
     * @return lpPair Address of created LP pair
     */
    function _createUniswapV2Pair(
        address datasetToken,
        uint256 ethAmount,
        uint256 tokenAmount
    ) internal returns (address lpPair) {
        // Check if pair already exists
        lpPair = IUniswapV2Factory(UNISWAP_V2_FACTORY).getPair(datasetToken, WETH);
        
        // Create pair only if it doesn't exist
        if (lpPair == address(0)) {
            lpPair = IUniswapV2Factory(UNISWAP_V2_FACTORY).createPair(datasetToken, WETH);
            
            if (lpPair == address(0)) {
                revert GraduationFailed("pair_creation_failed");
            }
        }

        // Approve router to spend tokens
        SafeERC20.forceApprove(IERC20(datasetToken), UNISWAP_V2_ROUTER, tokenAmount);

        // Add liquidity via router
        try
            IUniswapV2Router(UNISWAP_V2_ROUTER).addLiquidityETH{value: ethAmount}(
                datasetToken,
                tokenAmount,
                tokenAmount, // min tokens (accept any)
                ethAmount, // min ETH (accept any)
                address(this), // LP tokens to this contract
                block.timestamp + 300 // 5 minute deadline
            )
        returns (uint256, uint256, uint256 liquidity) {
            if (liquidity == 0) {
                revert GraduationFailed("zero_liquidity");
            }
        } catch {
            revert GraduationFailed("add_liquidity_failed");
        }
        return lpPair;
    }

    /**
     * @notice Burn all LP tokens to dead address for permanent liquidity
     * @param lpPair LP pair address
     * @return lpTokensBurned Amount of LP tokens burned
     */
    function _burnLPTokens(address lpPair) internal returns (uint256 lpTokensBurned) {
        lpTokensBurned = IERC20(lpPair).balanceOf(address(this));

        if (lpTokensBurned > 0) {
            // Transfer LP tokens to dead address (permanent burn)
            IERC20(lpPair).safeTransfer(DEAD_ADDRESS, lpTokensBurned);
        }

        return lpTokensBurned;
    }

    // ----------- Governance Functions ----------- //
    /**
     * @notice Set dataset factory address (timelock only)
     * @param _datasetFactory New dataset factory address
     */
    function setDatasetFactory(address _datasetFactory) external onlyTimelock {
        if (_datasetFactory == address(0)) revert InvalidParameter("dataset_factory");
        address oldFactory = datasetFactory;
        datasetFactory = _datasetFactory;
        emit DatasetFactoryUpdated(oldFactory, _datasetFactory);
    }

    /**
     * @notice Set burn portal address (timelock only)
     * @param _burnPortal New burn portal address
     */
    function setBurnPortal(address _burnPortal) external onlyTimelock {
        if (_burnPortal == address(0)) revert InvalidParameter("burn_portal");
        address oldPortal = burnPortal;
        burnPortal = _burnPortal;
        emit BurnPortalUpdated(oldPortal, _burnPortal);
    }

    // ----------- View Functions ----------- //
    /**
     * @notice Get graduation info for a dataset
     * @param datasetToken Dataset token address
     * @return info Graduation information
     */
    function getGraduationInfo(address datasetToken) external view returns (GraduationInfo memory info) {
        return graduationInfo[datasetToken];
    }


    /**
     * @notice Check if a dataset has graduated
     * @param datasetToken Dataset token address
     * @return Whether the dataset has graduated
     */
    function isGraduated(address datasetToken) external view returns (bool) {
        return graduationInfo[datasetToken].isGraduated;
    }

    // ----------- Emergency Functions ----------- //
    /**
     * @notice Emergency ETH rescue (guardian only)
     * @dev Only for stuck ETH in emergency situations
     */
    function rescueETH() external onlyGuardian {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool success, ) = GUARDIAN.call{value: balance}("");
            if (!success) revert SecurityViolation("rescue_eth_failed");
        }
    }

    /**
     * @notice Emergency token rescue (guardian only)
     * @param token Token address to rescue
     * @dev Only for stuck tokens in emergency situations
     */
    function rescueTokens(address token) external onlyGuardian {
        if (token == address(0)) revert InvalidParameter("token");

        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) {
            IERC20(token).safeTransfer(GUARDIAN, balance);
        }
    }

    /// @notice Receive ETH from bonding curves
    receive() external payable {
        // Accept ETH from bonding curve finalizations
    }
}

/**
 * @title IBondingCurve
 * @notice Interface for bonding curve graduation
 */
interface IBondingCurve {
    function finalizeGraduation() external;
}

/**
 * @title IDatasetToken
 * @notice Interface for dataset token graduation
 */
interface IDatasetToken {
    function graduate() external;
}

/**
 * @title IBurnPortal
 * @notice Interface for burn portal activation
 */
interface IBurnPortal {
    function activateDataset(address datasetToken) external;
}

/**
 * @title IUniswapV2Factory
 * @notice Interface for Uniswap V2 Factory
 */
interface IUniswapV2Factory {
    function createPair(address tokenA, address tokenB) external returns (address pair);
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

/**
 * @title IUniswapV2Router
 * @notice Interface for Uniswap V2 Router
 */
interface IUniswapV2Router {
    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);
}
