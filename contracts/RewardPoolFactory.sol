// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title RewardPoolFactory
 * @notice Factory for creating EIP-1167 minimal proxy reward vaults with deterministic CREATE2 addresses
 * @dev Implements the factory pattern with centralized governance for publisher authority and token allow-list
 * @custom:security-contact security@clones.ai
 * @author CLONES
 */
contract RewardPoolFactory is AccessControl, Pausable, ReentrancyGuard {
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

    // Grace period for publisher rotation overlap
    /// @notice Grace period for publisher rotation
    uint256 public constant PUBLISHER_GRACE_PERIOD = 7 days;

    // ----------- Immutable State ----------- //
    /// @notice Address of the pool implementation contract for cloning
    address public immutable POOL_IMPLEMENTATION;
    /// @notice Address of the platform treasury for fee collection
    address public immutable PLATFORM_TREASURY;
    /// @notice Address of the timelock contract for governance
    address public immutable TIMELOCK;
    /// @notice Address of the guardian for emergency operations
    address public immutable GUARDIAN;

    // ----------- Publisher Management ----------- //
    /// @notice Current active publisher address
    address public publisher; // Current active publisher
    /// @notice Previous publisher address during grace period
    address public oldPublisher; // Previous publisher during grace period
    /// @notice Timestamp when grace period ends
    uint256 public graceEndTime; // When grace period for old publisher ends

    // ----------- Governance ----------- //
    /// @notice Mapping of allowed token addresses
    mapping(address => bool) public allowedTokens; // On-chain token allow-list
    /// @notice Nonce for deterministic pool creation per creator and token
    mapping(address => mapping(address => uint256)) public poolNonce; // creator -> token -> nonce

    // ----------- Events ----------- //
    /// @notice Emitted when a new pool is created
    /// @param creator Address that created the pool
    /// @param pool Address of the newly created pool
    /// @param token Token address for the pool
    /// @param salt Salt used for deterministic creation
    /// @param nonce Nonce used for the creation
    event PoolCreated(
        address indexed creator,
        address indexed pool,
        address indexed token,
        bytes32 salt,
        uint256 nonce
    );
    /// @notice Emitted when a new pool is created and funded in one transaction
    /// @param creator Address that created the pool
    /// @param pool Address of the newly created pool
    /// @param token Token address for the pool
    /// @param salt Salt used for deterministic creation
    /// @param nonce Nonce used for the creation
    /// @param fundingAmount Amount of tokens used to fund the pool
    event PoolCreatedAndFunded(
        address indexed creator,
        address indexed pool,
        address indexed token,
        bytes32 salt,
        uint256 nonce,
        uint256 fundingAmount
    );
    /// @notice Emitted when token allowlist status is updated
    /// @param token Token address
    /// @param allowed New allowlist status
    event TokenAllowedUpdated(address indexed token, bool indexed allowed);
    /// @notice Emitted when publisher rotation is initiated
    /// @param oldPublisher Previous publisher address
    /// @param newPublisher New publisher address
    /// @param graceEndTime Timestamp when grace period ends
    event PublisherRotationInitiated(
        address indexed oldPublisher,
        address indexed newPublisher,
        uint256 indexed graceEndTime
    );
    /// @notice Emitted when publisher rotation is cancelled
    /// @param restoredPublisher Publisher address that was restored
    /// @param cancelledPublisher Publisher address that was cancelled
    event PublisherRotationCancelled(address indexed restoredPublisher, address indexed cancelledPublisher);

    // ----------- Modifiers ----------- //
    modifier onlyFactoryTimelock() {
        if (msg.sender != TIMELOCK) revert Unauthorized("timelock");
        _;
    }

    modifier onlyFactoryGuardian() {
        if (msg.sender != GUARDIAN) revert Unauthorized("guardian");
        _;
    }

    // ----------- Constructor ----------- //
    /// @notice Initialize the RewardPoolFactory
    /// @param _poolImplementation Address of the pool implementation contract
    /// @param _platformTreasury Address of the platform treasury
    /// @param _timelock Address of the timelock contract
    /// @param _guardian Address of the guardian
    /// @param _publisher Initial publisher address
    constructor(
        address _poolImplementation,
        address _platformTreasury,
        address _timelock,
        address _guardian,
        address _publisher
    ) {
        if (_poolImplementation == address(0)) revert InvalidParameter("implementation");
        if (_platformTreasury == address(0)) revert InvalidParameter("treasury");
        if (_timelock == address(0)) revert InvalidParameter("timelock");
        if (_guardian == address(0)) revert InvalidParameter("guardian");
        if (_publisher == address(0)) revert InvalidParameter("publisher");

        POOL_IMPLEMENTATION = _poolImplementation;
        PLATFORM_TREASURY = _platformTreasury;
        TIMELOCK = _timelock;
        GUARDIAN = _guardian;
        publisher = _publisher;

        _grantRole(DEFAULT_ADMIN_ROLE, _timelock);
        _grantRole(TIMELOCK_ROLE, _timelock);
        _grantRole(EMERGENCY_ROLE, _guardian);
    }

    // ----------- Token Allow-list Management ----------- //
    /**
     * @notice Manage token allow-list - CRITICAL: Only add battle-tested tokens
     * @dev Only add tokens that are:
     *      - Standard ERC-20 (no hooks, no callbacks, no rebasing)
     *      - Battle-tested on Base L2 with significant liquidity
     *      - No fee-on-transfer, no proxy upgrades, no exotic behaviors
     * @param token Token address
     * @param allowed Whether token is allowed
     */
    function setTokenAllowed(address token, bool allowed) external onlyFactoryTimelock {
        if (token == address(0)) revert InvalidParameter("token");
        allowedTokens[token] = allowed;
        emit TokenAllowedUpdated(token, allowed);
    }

    // ----------- Pool Creation ----------- //
    /**
     * @notice Create a new reward pool using EIP-1167 minimal proxy pattern
     * @dev Uses deterministic CREATE2 for predictable addresses
     * @param token Token address for rewards (must be in allow-list)
     * @return pool Address of the created pool
     */
    function createPool(address token) external whenNotPaused nonReentrant returns (address pool) {
        pool = _createPool(token, 0);
    }

    /**
     * @notice Create and fund a reward pool atomically using EIP-1167 minimal proxy pattern
     * @dev Combines pool creation and funding in a single transaction for optimal UX and gas efficiency
     * @param token Token address for rewards (must be in allow-list)
     * @param fundingAmount Amount to fund the pool (requires prior allowance)
     * @return pool Address of the created and funded pool
     */
    function createAndFundPool(
        address token,
        uint256 fundingAmount
    ) external whenNotPaused nonReentrant returns (address pool) {
        if (!allowedTokens[token]) revert InvalidParameter("token");
        if (fundingAmount == 0) revert InvalidParameter("amount");

        // Validate allowance before proceeding
        uint256 allowance = IERC20(token).allowance(msg.sender, address(this));
        if (allowance < fundingAmount) revert SecurityViolation("insufficient_allowance");

        pool = _createPool(token, fundingAmount);
    }

    /**
     * @notice Internal pool creation logic shared by both public functions
     * @dev Handles pool creation with optional funding
     * @param token Token address for rewards (must be in allow-list)
     * @param fundingAmount Amount to fund (0 for no funding)
     * @return pool Address of the created pool
     */
    function _createPool(address token, uint256 fundingAmount) internal returns (address pool) {
        if (!allowedTokens[token]) revert InvalidParameter("token");

        // Use centralized salt generation - deterministic, no race conditions
        uint256 nonce = poolNonce[msg.sender][token];
        bytes32 salt = _computeSalt(msg.sender, token, nonce);
        pool = Clones.cloneDeterministic(POOL_IMPLEMENTATION, salt);

        // Verify prediction matches reality (sanity check) BEFORE incrementing nonce
        (address predicted, ) = predictPoolAddressWithNonce(msg.sender, token, nonce);
        if (pool != predicted) revert SecurityViolation("create2");

        // Increment nonce for the next creation
        ++poolNonce[msg.sender][token];

        // Initialize the clone with factory reference
        IRewardPoolImplementation(pool).initialize(token, PLATFORM_TREASURY, address(this), msg.sender);

        // Fund pool if amount specified
        if (fundingAmount > 0) {
            bool success = IERC20(token).transferFrom(msg.sender, pool, fundingAmount);
            if (!success) revert SecurityViolation("token_transfer");

            emit PoolCreatedAndFunded(msg.sender, pool, token, salt, nonce, fundingAmount);
        } else {
            emit PoolCreated(msg.sender, pool, token, salt, nonce);
        }
    }

    /**
     * @notice Predict pool address before creation
     * @param creator Creator address
     * @param token Token address
     * @return predicted Predicted pool address
     * @return salt Salt used for CREATE2
     */
    function predictPoolAddress(
        address creator,
        address token
    ) external view returns (address predicted, bytes32 salt) {
        uint256 nonce = poolNonce[creator][token];
        salt = _computeSalt(creator, token, nonce);
        predicted = Clones.predictDeterministicAddress(POOL_IMPLEMENTATION, salt, address(this));
    }

    /**
     * @notice Predict pool address with a specific nonce (for tests and internal checks)
     * @param creator Creator address
     * @param token Token address
     * @param nonce Nonce to use for prediction
     * @return predicted Predicted pool address
     * @return salt Salt used for CREATE2
     */
    function predictPoolAddressWithNonce(
        address creator,
        address token,
        uint256 nonce
    ) public view returns (address predicted, bytes32 salt) {
        salt = _computeSalt(creator, token, nonce);
        predicted = Clones.predictDeterministicAddress(POOL_IMPLEMENTATION, salt, address(this));
    }

    /**
     * @notice Centralized salt generation - CRITICAL: Must match TypeScript exactly
     * @dev Uses abi.encode for deterministic behavior (no counter race conditions)
     * @param creator Creator address
     * @param token Token address
     * @param nonce Nonce for deterministic creation
     * @return Salt for CREATE2
     */
    function _computeSalt(address creator, address token, uint256 nonce) internal pure returns (bytes32) {
        // EXACT ABI encoding: deterministic by creator + token pair
        return keccak256(abi.encode(creator, token, nonce));
    }

    // ----------- Publisher Management ----------- //
    /**
     * @notice Get current publisher information for all vaults
     * @return current Current active publisher
     * @return old Previous publisher (if in grace period)
     * @return graceEnd When grace period ends
     */
    function getPublisherInfo() external view returns (address current, address old, uint256 graceEnd) {
        return (publisher, oldPublisher, graceEndTime);
    }

    /**
     * @notice Get guardian address
     * @return Guardian address
     */
    function getGuardianInfo() external view returns (address) {
        return GUARDIAN;
    }

    /**
     * @notice Initiate publisher rotation with immediate overlap (eliminates SPOF)
     * @param newPublisher New publisher address
     */
    function initiatePublisherRotation(address newPublisher) external onlyFactoryTimelock {
        if (newPublisher == address(0)) revert InvalidParameter("publisher");
        if (newPublisher == publisher) revert InvalidParameter("publisher");
        if (graceEndTime > block.timestamp) revert AlreadyExists("rotation");

        // IMMEDIATE transition - no pending period
        oldPublisher = publisher; // Store current for grace period
        publisher = newPublisher; // IMMEDIATE activation
        graceEndTime = block.timestamp + PUBLISHER_GRACE_PERIOD; // 7 days overlap

        emit PublisherRotationInitiated(oldPublisher, newPublisher, graceEndTime);
    }

    /**
     * @notice Cancel publisher rotation during grace period
     */
    function cancelPublisherRotation() external onlyFactoryTimelock {
        // POLICY: Cancellation only possible during grace period (7 days)
        if (graceEndTime == 0) revert InvalidParameter("no_rotation");
        if (block.timestamp >= graceEndTime) revert SecurityViolation("grace_period");

        // Capture current state BEFORE modification for accurate event emission
        address cancelledPublisher = publisher; // The publisher being cancelled (new one)
        address restoredPublisher = oldPublisher; // The publisher being restored (old one)

        publisher = oldPublisher; // Restore old publisher
        oldPublisher = address(0); // Clear old
        graceEndTime = 0; // End grace period immediately

        // EVENT REFLECTS ACTUAL STATE: restored (old) and cancelled (new)
        emit PublisherRotationCancelled(restoredPublisher, cancelledPublisher);
    }

    // ----------- Emergency Controls ----------- //
    /**
     * @notice Emergency pause (guardian role)
     */
    function pause() external onlyFactoryGuardian {
        _pause();
    }

    /**
     * @notice Unpause (requires timelock)
     */
    function unpause() external onlyFactoryTimelock {
        _unpause();
    }
}

/**
 * @title IRewardPoolImplementation
 * @notice Interface for reward pool implementation initialization
 * @author CLONES
 */
interface IRewardPoolImplementation {
    /// @notice Initialize the reward pool implementation
    /// @param token Token address for rewards
    /// @param platformTreasury Treasury address for fees
    /// @param factory Factory address for governance
    /// @param creator Creator address for governance
    function initialize(address token, address platformTreasury, address factory, address creator) external;
}
