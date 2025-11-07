// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAggregatorV3Interface} from "../interfaces/IAggregatorV3Interface.sol";

/**
 * @title DatasetFactory
 * @notice Factory for creating EIP-1167 minimal proxy dataset tokens with bonding curves
 * @dev Implements the factory pattern with deterministic CREATE2 addresses for datasets
 * @author CLONES
 */
contract DatasetFactory is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ----------- Custom Errors ----------- //
    error InvalidParameter(string param);
    error Unauthorized(string role);
    error AlreadyExists(string resource);
    error SecurityViolation(string check);

    // ----------- Constants ----------- //
    /// @notice Role identifier for timelock operations
    bytes32 public constant TIMELOCK_ROLE = keccak256("TIMELOCK_ROLE");
    /// @notice Role identifier for emergency operations
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    /// @notice Required ETH liquidity contribution (0.02 ETH ≈ $50)
    uint256 public constant LIQUIDITY_CONTRIBUTION = 0.02 ether;
    /// @notice Target launch fee in USD (18 decimals) - $50
    uint256 public constant TARGET_LAUNCH_FEE_USD = 50 * 1e18;
    /// @notice Maximum age for price data (1 hour)
    uint256 public constant PRICE_STALENESS_THRESHOLD = 3600;

    // ----------- Immutable State ----------- //
    /// @notice Address of the dataset token implementation contract for cloning
    address public immutable DATASET_TOKEN_IMPLEMENTATION;
    /// @notice Address of the bonding curve implementation contract for cloning
    address public immutable BONDING_CURVE_IMPLEMENTATION;
    /// @notice Address of the CLONES token for launch fees
    IERC20 public immutable CLONES_TOKEN;
    /// @notice Address of the protocol fee recipient
    address public immutable PROTOCOL_FEE_RECIPIENT;
    /// @notice Address of the timelock contract for governance
    address public immutable TIMELOCK;
    /// @notice Address of the guardian for emergency operations
    address public immutable GUARDIAN;
    /// @notice Chainlink CLONES/USD price feed (could be via ETH/USD + CLONES/ETH)
    IAggregatorV3Interface public immutable CLONES_USD_PRICE_FEED;
    /// @notice Chainlink ETH/USD price feed for bonding curve graduation
    IAggregatorV3Interface public immutable ETH_USD_PRICE_FEED;

    // ----------- Governance ----------- //
    /// @notice Fallback launch fee in CLONES tokens (used when oracle fails)
    uint256 public fallbackLaunchFee;
    /// @notice Whether to use oracle for dynamic pricing
    bool public useOracle;
    /// @notice Graduation manager contract address
    address public graduationManager;
    /// @notice Burn portal contract address
    address public burnPortal;
    /// @notice Nonce for deterministic dataset creation per creator
    mapping(address => uint256) public creatorNonce;

    // ----------- Dataset Tracking ----------- //
    /// @notice Mapping of dataset token address => creator address
    mapping(address => address) public datasetCreators;
    /// @notice Mapping of dataset token address => bonding curve address
    mapping(address => address) public datasetBondingCurves;

    // ----------- Events ----------- //
    /// @notice Emitted when a new dataset is created
    event DatasetCreated(
        address indexed creator,
        address indexed datasetToken,
        address indexed bondingCurve,
        string name,
        string symbol,
        uint8 burnThresholdPercentage,
        bytes32 salt,
        uint256 nonce,
        uint256 timestamp
    );
    /// @notice Emitted when launch fee is updated
    event LaunchFeeUpdated(uint256 oldFee, uint256 newFee);
    /// @notice Emitted when graduation manager is updated
    event GraduationManagerUpdated(address indexed oldManager, address indexed newManager);
    /// @notice Emitted when burn portal is updated
    event BurnPortalUpdated(address indexed oldPortal, address indexed newPortal);
    /// @notice Emitted when oracle usage is toggled
    event OracleUsageUpdated(bool indexed useOracle);
    /// @notice Emitted when fallback launch fee is updated
    event FallbackLaunchFeeUpdated(uint256 oldFee, uint256 newFee);

    // ----------- Modifiers ----------- //
    modifier onlyTimelock() {
        if (msg.sender != TIMELOCK) revert Unauthorized("timelock");
        _;
    }

    modifier onlyGuardian() {
        if (msg.sender != GUARDIAN) revert Unauthorized("guardian");
        _;
    }

    // ----------- Constructor ----------- //
    /// @notice Initialize the DatasetFactory
    /// @param _datasetTokenImplementation Address of the dataset token implementation
    /// @param _bondingCurveImplementation Address of the bonding curve implementation
    /// @param _clonesToken Address of the CLONES token for launch fees
    /// @param _protocolFeeRecipient Address of the protocol fee recipient
    /// @param _timelock Address of the timelock contract
    /// @param _guardian Address of the guardian
    /// @param _clonesUsdPriceFeed Chainlink CLONES/USD price feed
    /// @param _ethUsdPriceFeed Chainlink ETH/USD price feed
    /// @param _fallbackLaunchFee Fallback launch fee in CLONES tokens
    constructor(
        address _datasetTokenImplementation,
        address _bondingCurveImplementation,
        address _clonesToken,
        address _protocolFeeRecipient,
        address _timelock,
        address _guardian,
        address _clonesUsdPriceFeed,
        address _ethUsdPriceFeed,
        uint256 _fallbackLaunchFee
    ) {
        if (_datasetTokenImplementation == address(0)) revert InvalidParameter("dataset_implementation");
        if (_bondingCurveImplementation == address(0)) revert InvalidParameter("curve_implementation");
        if (_clonesToken == address(0)) revert InvalidParameter("clones_token");
        if (_protocolFeeRecipient == address(0)) revert InvalidParameter("protocol_fee_recipient");
        if (_timelock == address(0)) revert InvalidParameter("timelock");
        if (_guardian == address(0)) revert InvalidParameter("guardian");
        if (_clonesUsdPriceFeed == address(0)) revert InvalidParameter("clones_price_feed");
        if (_ethUsdPriceFeed == address(0)) revert InvalidParameter("eth_price_feed");

        DATASET_TOKEN_IMPLEMENTATION = _datasetTokenImplementation;
        BONDING_CURVE_IMPLEMENTATION = _bondingCurveImplementation;
        CLONES_TOKEN = IERC20(_clonesToken);
        PROTOCOL_FEE_RECIPIENT = _protocolFeeRecipient;
        TIMELOCK = _timelock;
        GUARDIAN = _guardian;
        CLONES_USD_PRICE_FEED = IAggregatorV3Interface(_clonesUsdPriceFeed);
        ETH_USD_PRICE_FEED = IAggregatorV3Interface(_ethUsdPriceFeed);
        fallbackLaunchFee = _fallbackLaunchFee;
        useOracle = true; // Enable oracle by default

        _grantRole(DEFAULT_ADMIN_ROLE, _timelock);
        _grantRole(TIMELOCK_ROLE, _timelock);
        _grantRole(EMERGENCY_ROLE, _guardian);
    }

    // ----------- Dataset Creation ----------- //
    /**
     * @notice Create a new dataset token with bonding curve using EIP-1167 minimal proxy pattern
     * @dev Uses deterministic CREATE2 for predictable addresses
     * @param name Dataset token name
     * @param symbol Dataset token symbol
     * @param burnThresholdPercentage Percentage of supply required to burn (1-10%)
     * @return datasetToken Address of the created dataset token
     * @return bondingCurve Address of the created bonding curve
     */
    function createDataset(
        string memory name,
        string memory symbol,
        uint8 burnThresholdPercentage
    ) external payable whenNotPaused nonReentrant returns (address datasetToken, address bondingCurve) {
        if (msg.value < LIQUIDITY_CONTRIBUTION) revert InvalidParameter("insufficient_liquidity");
        if (burnThresholdPercentage < 1 || burnThresholdPercentage > 10) {
            revert InvalidParameter("burn_threshold");
        }
        if (graduationManager == address(0)) revert SecurityViolation("graduation_manager_not_set");
        if (burnPortal == address(0)) revert SecurityViolation("burn_portal_not_set");

        // Get current launch fee (oracle or fallback)
        uint256 currentLaunchFee = getCurrentLaunchFee();
        
        // Transfer CLONES launch fee
        CLONES_TOKEN.safeTransferFrom(msg.sender, PROTOCOL_FEE_RECIPIENT, currentLaunchFee);

        // Generate deterministic addresses using CREATE2
        uint256 nonce = creatorNonce[msg.sender];
        bytes32 salt = _computeSalt(msg.sender, name, symbol, nonce);
        
        // Deploy dataset token clone
        datasetToken = Clones.cloneDeterministic(DATASET_TOKEN_IMPLEMENTATION, salt);
        
        // Deploy bonding curve clone with liquidity
        bondingCurve = Clones.cloneDeterministic(BONDING_CURVE_IMPLEMENTATION, _modifySalt(salt, 1));

        // Verify predictions match reality (sanity check)
        (address predictedToken, address predictedCurve) = predictDatasetAddressWithNonce(
            msg.sender, name, symbol, nonce
        );
        if (datasetToken != predictedToken || bondingCurve != predictedCurve) {
            revert SecurityViolation("create2_mismatch");
        }

        // Increment nonce for next creation
        ++creatorNonce[msg.sender];

        // Initialize dataset token
        IDatasetTokenImplementation(datasetToken).initialize(
            name,
            symbol,
            msg.sender,
            address(this),
            burnThresholdPercentage
        );

        // Initialize bonding curve with liquidity
        IBondingCurveImplementation(bondingCurve).initialize{value: msg.value}(
            datasetToken,
            msg.sender,
            PROTOCOL_FEE_RECIPIENT,
            address(this),
            graduationManager,
            address(ETH_USD_PRICE_FEED)
        );

        // Set cross-references
        IDatasetTokenImplementation(datasetToken).setBondingCurve(bondingCurve);
        IDatasetTokenImplementation(datasetToken).setGraduationManager(graduationManager);
        IDatasetTokenImplementation(datasetToken).setBurnPortal(burnPortal);

        // Store dataset info
        datasetCreators[datasetToken] = msg.sender;
        datasetBondingCurves[datasetToken] = bondingCurve;

        emit DatasetCreated(
            msg.sender,
            datasetToken,
            bondingCurve,
            name,
            symbol,
            burnThresholdPercentage,
            salt,
            nonce,
            block.timestamp
        );
    }

    // ----------- Address Prediction ----------- //
    /**
     * @notice Predict dataset addresses before creation
     * @param creator Creator address
     * @param name Dataset name
     * @param symbol Dataset symbol
     * @return datasetToken Predicted dataset token address
     * @return bondingCurve Predicted bonding curve address
     */
    function predictDatasetAddress(
        address creator,
        string memory name,
        string memory symbol
    ) external view returns (address datasetToken, address bondingCurve) {
        uint256 nonce = creatorNonce[creator];
        return predictDatasetAddressWithNonce(creator, name, symbol, nonce);
    }

    /**
     * @notice Predict dataset addresses with specific nonce
     * @param creator Creator address
     * @param name Dataset name
     * @param symbol Dataset symbol
     * @param nonce Nonce to use for prediction
     * @return datasetToken Predicted dataset token address
     * @return bondingCurve Predicted bonding curve address
     */
    function predictDatasetAddressWithNonce(
        address creator,
        string memory name,
        string memory symbol,
        uint256 nonce
    ) public view returns (address datasetToken, address bondingCurve) {
        bytes32 salt = _computeSalt(creator, name, symbol, nonce);
        
        datasetToken = Clones.predictDeterministicAddress(
            DATASET_TOKEN_IMPLEMENTATION, 
            salt, 
            address(this)
        );
        
        bondingCurve = Clones.predictDeterministicAddress(
            BONDING_CURVE_IMPLEMENTATION, 
            _modifySalt(salt, 1), 
            address(this)
        );
    }

    /**
     * @notice Compute salt for deterministic creation
     * @param creator Creator address
     * @param name Dataset name
     * @param symbol Dataset symbol
     * @param nonce Creator nonce
     * @return Salt for CREATE2
     */
    function _computeSalt(
        address creator,
        string memory name,
        string memory symbol,
        uint256 nonce
    ) internal view returns (bytes32) {
        return keccak256(abi.encode(creator, name, symbol, nonce, block.chainid));
    }

    /**
     * @notice Modify salt for different contract types
     * @param baseSalt Base salt
     * @param saltModifier Modifier for different contracts
     * @return Modified salt
     */
    function _modifySalt(bytes32 baseSalt, uint256 saltModifier) internal pure returns (bytes32) {
        return keccak256(abi.encode(baseSalt, saltModifier));
    }

    // ----------- Oracle Functions ----------- //
    /**
     * @notice Get current launch fee in CLONES tokens based on USD target
     * @return currentFee Amount of CLONES tokens required (~$50 USD)
     */
    function getCurrentLaunchFee() public view returns (uint256 currentFee) {
        if (!useOracle) {
            return fallbackLaunchFee;
        }
        
        try this._getOracleLaunchFee() returns (uint256 oracleFee) {
            return oracleFee;
        } catch {
            // Oracle failed, use fallback
            return fallbackLaunchFee;
        }
    }

    /**
     * @notice Get launch fee from oracle (external call for try/catch)
     * @return oracleFee Launch fee calculated from oracle price
     */
    function _getOracleLaunchFee() external view returns (uint256 oracleFee) {
        (, int256 price, , uint256 updatedAt, ) = CLONES_USD_PRICE_FEED.latestRoundData();
        
        // Validate price data
        if (price <= 0) revert SecurityViolation("invalid_price");
        if (block.timestamp - updatedAt > PRICE_STALENESS_THRESHOLD) {
            revert SecurityViolation("stale_price");
        }
        
        // Convert price to 18 decimals (Chainlink typically uses 8 decimals)
        uint8 priceFeedDecimals = CLONES_USD_PRICE_FEED.decimals();
        uint256 clonesPrice = uint256(price) * (10 ** (18 - priceFeedDecimals));
        
        // Calculate CLONES amount for TARGET_LAUNCH_FEE_USD
        // CLONES token has 18 decimals
        oracleFee = Math.mulDiv(TARGET_LAUNCH_FEE_USD, 1e18, clonesPrice);
    }

    // ----------- Governance Functions ----------- //
    /**
     * @notice Update fallback launch fee (timelock only)
     * @param newFee New fallback launch fee in CLONES tokens
     */
    function setFallbackLaunchFee(uint256 newFee) external onlyTimelock {
        uint256 oldFee = fallbackLaunchFee;
        fallbackLaunchFee = newFee;
        emit FallbackLaunchFeeUpdated(oldFee, newFee);
    }

    /**
     * @notice Toggle oracle usage (timelock only)
     * @param _useOracle Whether to use oracle for pricing
     */
    function setOracleUsage(bool _useOracle) external onlyTimelock {
        useOracle = _useOracle;
        emit OracleUsageUpdated(_useOracle);
    }

    /**
     * @notice Emergency disable oracle (guardian only)
     * @dev Used when oracle is compromised or malfunctioning
     */
    function emergencyDisableOracle() external onlyGuardian {
        useOracle = false;
        emit OracleUsageUpdated(false);
    }

    /**
     * @notice Set graduation manager address (timelock only)
     * @param _graduationManager New graduation manager address
     */
    function setGraduationManager(address _graduationManager) external onlyTimelock {
        if (_graduationManager == address(0)) revert InvalidParameter("graduation_manager");
        address oldManager = graduationManager;
        graduationManager = _graduationManager;
        emit GraduationManagerUpdated(oldManager, _graduationManager);
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
     * @notice Get dataset info
     * @param datasetToken Dataset token address
     * @return creator Dataset creator
     * @return bondingCurve Bonding curve address
     */
    function getDatasetInfo(address datasetToken) external view returns (
        address creator,
        address bondingCurve
    ) {
        creator = datasetCreators[datasetToken];
        bondingCurve = datasetBondingCurves[datasetToken];
    }

    // ----------- Emergency Controls ----------- //
    /**
     * @notice Emergency pause (guardian role)
     */
    function pause() external onlyGuardian {
        _pause();
    }

    /**
     * @notice Unpause (requires timelock)
     */
    function unpause() external onlyTimelock {
        _unpause();
    }
}

/**
 * @title IDatasetTokenImplementation
 * @notice Interface for dataset token implementation initialization
 */
interface IDatasetTokenImplementation {
    function initialize(
        string memory name,
        string memory symbol,
        address creator,
        address factory,
        uint8 burnThresholdPercentage
    ) external;
    
    function setBondingCurve(address bondingCurve) external;
    function setGraduationManager(address graduationManager) external;
    function setBurnPortal(address burnPortal) external;
}

/**
 * @title IBondingCurveImplementation
 * @notice Interface for bonding curve implementation initialization
 */
interface IBondingCurveImplementation {
    function initialize(
        address datasetToken,
        address creator,
        address protocolFeeRecipient,
        address factory,
        address graduationManager,
        address ethUsdPriceFeed
    ) external payable;
}