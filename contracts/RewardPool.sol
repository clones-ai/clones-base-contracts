// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * @title RewardPool (UUPS Upgradeable)
 * @notice Centralized reward pool for multiple factories. Farmers withdraw their rewards and pay gas.
 *         A platform fee is skimmed on each withdrawal and sent to the treasury. Supports multiple ERC20 tokens
 *         and native ETH on Base.
 * @dev    Designed for Base L2. Uses OZ v5.x upgradeable contracts.
 *         Enhanced with Task ID system and Nonce-based withdrawals for maximum security.
 *
 *         IMPORTANT: This contract only supports standard ERC-20 tokens without transfer fees,
 *         rebasing, or other non-standard behavior. Tokens with transfer taxes, rebasing,
 *         or other mechanisms that alter the actual amount received are NOT supported and
 *         may cause accounting inconsistencies.
 * @custom:security-contact security@clones.ai
 * @author CLONES
 */

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlEnumerableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlEnumerableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title RewardPool (UUPS Upgradeable)
 * @notice Centralized reward pool for multiple factories. Farmers withdraw their rewards and pay gas.
 *         A platform fee is skimmed on each withdrawal and sent to the treasury. Supports multiple ERC20 tokens
 *         and native ETH on Base.
 * @dev    Designed for Base L2. Uses OZ v5.x upgradeable contracts.
 *         Enhanced with Task ID system and Nonce-based withdrawals for maximum security.
 *
 *         IMPORTANT: This contract only supports standard ERC-20 tokens without transfer fees,
 *         rebasing, or other non-standard behavior. Tokens with transfer taxes, rebasing,
 *         or other mechanisms that alter the actual amount received are NOT supported and
 *         may cause accounting inconsistencies.
 * @custom:security-contact security@clones.ai
 */
contract RewardPool is
    Initializable,
    UUPSUpgradeable,
    AccessControlEnumerableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ----------- Roles ----------- //
    /// @notice Role for factories to fund the pool and record rewards.
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");
    /// @notice Role for pausing/unpausing the contract in emergencies.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    /// @notice Role for managing treasury, fees, and sweeping funds.
    bytes32 public constant TREASURER_ROLE = keccak256("TREASURER_ROLE");

    // ----------- Errors ----------- //
    error ZeroAddress();
    error InvalidFee();
    error TreasuryNotSet();
    error InsufficientFactoryFunds();
    error NothingToWithdraw();
    error DirectEthNotAllowed();
    error TaskAlreadyCompleted();
    error InvalidNonce();
    error WithdrawalTooSoon();
    error InvalidTaskId();
    error UnsupportedToken();
    error AccountingError();
    error TooManyTokensInSweep();
    error SequencerDown();
    error TooManyBatches();
    error TooManyFactories();
    error ArrayTooLong();
    error SequencerFeedUnavailable();
    error FeedCannotBeZeroAddress();
    error FactoryCannotBeZeroAddress();

    // --- Specific Error Messages ---
    error AdminCannotBeZeroAddress();
    error TreasuryCannotBeZeroAddress();
    error TokenCannotBeZeroAddress();
    error FarmerCannotBeZeroAddress();
    error ReceiverCannotBeZeroAddress();
    error FeeExceedsMaxFee();
    error InvalidNewImplementation();

    // ----------- Events ----------- //
    /**
     * @notice Emitted when the treasury address is updated.
     * @param oldTreasury The previous treasury address.
     * @param newTreasury The new treasury address.
     */
    event TreasuryUpdated(
        address indexed oldTreasury,
        address indexed newTreasury
    );
    /**
     * @notice Emitted when the platform fee is updated.
     * @param oldFeeBps The previous fee in basis points.
     * @param newFeeBps The new fee in basis points.
     */
    event FeeUpdated(uint16 indexed oldFeeBps, uint16 indexed newFeeBps);

    /**
     * @notice Emitted when fees for a specific token are successfully swept to the treasury.
     * @param token The address of the token for which fees were swept.
     * @param treasury The address of the treasury receiving the fees.
     * @param amount The amount of fees swept.
     */
    event FeeSwept(
        address indexed token,
        address indexed treasury,
        uint256 indexed amount
    );
    /**
     * @notice Emitted when a fee sweep for a specific token fails.
     * @param token The address of the token for which the fee sweep failed.
     * @param treasury The address of the treasury that was intended to receive the fees.
     * @param amount The amount of fees that failed to be swept.
     */
    event FeeSweepFailed(
        address indexed token,
        address indexed treasury,
        uint256 indexed amount
    );

    /**
     * @notice Emitted when a factory successfully funds the reward pool.
     * @param factory The address of the factory providing the funds.
     * @param token The address of the token being funded.
     * @param amount The expected amount of tokens to be funded.
     * @param actualAmountReceived The actual amount of tokens received after any potential transfer fees.
     */
    event FactoryFunded(
        address indexed factory,
        address indexed token,
        uint256 indexed amount,
        uint256 actualAmountReceived
    );
    /**
     * @notice Emitted when a factory refunds its unused funds from the pool.
     * @param factory The address of the factory refunding the funds.
     * @param token The address of the token being refunded.
     * @param amount The amount of tokens refunded.
     */
    event FactoryRefunded(
        address indexed factory,
        address indexed token,
        uint256 indexed amount
    );

    /**
     * @notice Emitted when a reward is recorded for a farmer by a factory.
     * @param factory The address of the factory that recorded the reward.
     * @param farmer The address of the farmer who earned the reward.
     * @param token The address of the reward token.
     * @param amount The amount of the reward.
     * @param timestamp The timestamp when the reward was recorded.
     */
    event RewardRecorded(
        address indexed factory,
        address indexed farmer,
        address indexed token,
        uint256 amount,
        uint256 timestamp
    );

    /**
     * @notice Emitted when a task is successfully completed and its reward recorded.
     * @param taskId The unique identifier for the completed task.
     * @param farmer The address of the farmer who completed the task.
     * @param factory The address of the factory that assigned the task.
     * @param token The address of the reward token.
     * @param amount The reward amount.
     * @param timestamp The timestamp of task completion.
     */
    event TaskCompleted(
        bytes32 indexed taskId,
        address indexed farmer,
        address indexed factory,
        address token,
        uint256 amount,
        uint256 timestamp
    );

    /**
     * @notice Emitted when a task's completion is validated on-chain.
     * @param taskId The unique identifier for the validated task.
     * @param farmer The address of the farmer associated with the task.
     * @param factory The address of the factory that validated the task.
     * @param blockNumber The block number at which the validation occurred.
     */
    event TaskValidated(
        bytes32 indexed taskId,
        address indexed farmer,
        address indexed factory,
        uint256 blockNumber
    );

    /**
     * @notice Emitted when a farmer withdraws rewards.
     * @param farmer The address of the farmer withdrawing rewards.
     * @param token The address of the token being withdrawn (address(0) for native ETH).
     * @param grossAmount The total amount of rewards withdrawn before fees.
     * @param feeAmount The portion of the withdrawal taken as a platform fee.
     * @param netAmount The net amount of rewards received by the farmer.
     * @param factoryCount The number of factories from which rewards were withdrawn.
     * @param timestamp The timestamp of the withdrawal.
     */
    event RewardsWithdrawn(
        address indexed farmer,
        address indexed token,
        uint256 grossAmount,
        uint256 feeAmount,
        uint256 netAmount,
        uint256 factoryCount,
        uint256 indexed timestamp
    );

    /**
     * @notice Emitted when a farmer's withdrawal nonce is incremented.
     * @param farmer The address of the farmer whose nonce was incremented.
     * @param oldNonce The nonce before the increment.
     * @param newNonce The nonce after the increment.
     */
    event WithdrawalNonceIncremented(
        address indexed farmer,
        uint256 indexed oldNonce,
        uint256 indexed newNonce
    );

    /**
     * @notice Emitted when the withdrawal cooldown period for a token is updated.
     * @param token The address of the token for which the cooldown was updated.
     * @param oldCooldown The previous cooldown period in seconds.
     * @param newCooldown The new cooldown period in seconds.
     */
    event TokenCooldownUpdated(
        address indexed token,
        uint256 indexed oldCooldown,
        uint256 indexed newCooldown
    );

    /**
     * @notice Emitted when ERC-20 tokens are recovered from the contract by an admin.
     * @param token The address of the recovered ERC-20 token.
     * @param to The address to which the tokens were sent.
     * @param amount The amount of tokens recovered.
     */
    event TokensRecovered(
        address indexed token,
        address indexed to,
        uint256 indexed amount
    );

    /**
     * @notice Emitted when a token check (support or compatibility) fails.
     * @param token The address of the token being checked.
     * @param checkType The type of check being performed (e.g., "isSupported", "testCompatibility").
     * @param reason The reason for the failure (e.g., revert data).
     */
    event TokenCheckFailed(
        address indexed token,
        string checkType,
        bytes reason
    );
    /**
     * @notice Emitted when the maximum platform fee is updated.
     * @param oldMaxFeeBps The previous maximum fee in basis points.
     * @param newMaxFeeBps The new maximum fee in basis points.
     */
    event MaxFeeBpsUpdated(
        uint16 indexed oldMaxFeeBps,
        uint16 indexed newMaxFeeBps
    );
    /**
     * @notice Emitted when the maximum number of tokens in a single sweep is updated.
     * @param oldMax The previous maximum number.
     * @param newMax The new maximum number.
     */
    event MaxSweepTokensUpdated(uint8 indexed oldMax, uint8 indexed newMax);
    /**
     * @notice Emitted when the maximum number of batches in a single withdrawal is updated.
     * @param oldMax The previous maximum number.
     * @param newMax The new maximum number.
     */
    event MaxBatchesUpdated(uint8 indexed oldMax, uint8 indexed newMax);
    /**
     * @notice Emitted when the maximum number of factories per withdrawal is updated.
     * @param oldMax The previous maximum number.
     * @param newMax The new maximum number.
     */
    event MaxFactoriesPerWithdrawalUpdated(
        uint8 indexed oldMax,
        uint8 indexed newMax
    );
    /**
     * @notice Emitted when the global withdrawal cooldown is updated.
     * @param oldCooldown The previous cooldown in seconds.
     * @param newCooldown The new cooldown in seconds.
     */
    event GlobalWithdrawalCooldownUpdated(
        uint256 indexed oldCooldown,
        uint256 indexed newCooldown
    );
    /**
     * @notice Emitted when the L2 sequencer uptime feed address is updated.
     * @param oldFeed The previous feed address.
     * @param newFeed The new feed address.
     */
    event SequencerUptimeFeedUpdated(
        address indexed oldFeed,
        address indexed newFeed
    );

    // ----------- Constants ----------- //
    /// @notice Maximum basis points, used for percentage calculations (100%).
    uint16 public constant MAX_BPS = 10_000;
    /// @notice Absolute maximum fee that can be set, to prevent misconfiguration (50%).
    uint16 public constant ABSOLUTE_MAX_FEE_BPS = 5_000;
    /// @notice Absolute maximum number of tokens that can be swept in a single transaction.
    uint8 public constant ABSOLUTE_MAX_SWEEP_TOKENS = 100;
    /// @notice Absolute maximum number of batches in a single withdrawal.
    uint8 public constant ABSOLUTE_MAX_BATCHES = 50;
    /// @notice Absolute maximum number of factories in a single withdrawal.
    uint8 public constant ABSOLUTE_MAX_FACTORIES_PER_WITHDRAWAL = 100;
    /// @notice Maximum array length for view functions.
    uint16 public constant MAX_VIEW_ARRAY_LENGTH = 200;
    /// @notice Sentinel value representing native ETH in the contract.
    address public constant NATIVE_TOKEN = address(0);

    // ----------- Config ----------- //
    /**
     * @notice Main configuration struct for the reward pool.
     */
    struct PoolConfig {
        address treasury; // where fees are sent
        uint16 feeBps; // platform fee in basis points
        uint256 withdrawalCooldown; // default minimum delay between withdrawals
        uint16 maxFeeBps; // Safety cap for feeBps
        uint8 maxSweepTokens; // Max tokens in a single sweepFees call
        uint8 maxBatches; // Max batches in a single withdrawBatch call
        uint8 maxFactoriesPerWithdrawal; // Max factories per withdrawal
        address sequencerUptimeFeed; // L2 sequencer health feed
    }

    /// @notice Stores the current configuration of the reward pool.
    PoolConfig public config;

    // ----------- L2 Health Check ----------- //
    /**
     * @notice Checks if the L2 sequencer is operational by querying the Chainlink feed.
     * @dev Reverts with `SequencerDown` if the sequencer is down, or `SequencerFeedUnavailable`
     *      if the feed cannot be reached. Skips the check if no feed is configured.
     */
    function _checkSequencerStatus() private view {
        // Fetches the latest sequencer health status from the Chainlink feed.
        // The feed returns 0 for a healthy sequencer and 1 for a down sequencer.
        // See: https://docs.chain.link/data-feeds/l2-sequencer-feeds
        address feed = config.sequencerUptimeFeed;
        if (feed == address(0)) {
            // If no feed is configured, the check is skipped.
            // This allows deployment on networks without a feed (e.g., local testnets).
            return;
        }

        try IAggregatorV3Interface(feed).latestRoundData() returns (
            uint80, // roundId (ignored)
            int256 answer, // response: 0 = up, 1 = down
            uint256, // startedAt (ignored)
            uint256, // updatedAt (ignored)
            uint80 // answeredInRound (ignored)
        ) {
            if (answer != 0) revert SequencerDown();
        } catch {
            // If the feed itself is unavailable, we cannot be sure of the sequencer's status.
            // Revert with a specific error to distinguish from actual sequencer downtime.
            revert SequencerFeedUnavailable();
        }
    }

    // ----------- Security Features ----------- //
    /// @notice Global nonce for each farmer (incremented on each withdrawal)
    mapping(address farmer => uint256 nonce) public farmerNonce;

    /// @notice Tracks completed tasks to prevent duplicate rewards
    mapping(bytes32 taskId => bool completed) public completedTasks;

    /// @notice Timestamp of last withdrawal per farmer/token (for rate limiting)
    mapping(address farmer => mapping(address token => uint256 lastWithdrawal))
        public lastWithdrawalTime;

    /// @notice Set different cooldown periods for different tokens
    mapping(address token => uint256 cooldown) public tokenSpecificCooldown;

    // ----------- Accounting ----------- //
    /// @notice Tokens deposited by each factory into the pool that are not yet allocated to farmers
    mapping(address factory => mapping(address token => uint256 amount))
        public factoryFunding;

    // Accrued rewards per farmer per factory per token (auditable source of truth).
    // The three address keys (farmer, factory, token) are packed and hashed to form a single bytes32 key
    // to save gas on storage access compared to deeply nested mappings.
    mapping(bytes32 => uint256) internal accrued;

    /// @notice Aggregated owed per farmer per token (gas-friendly for reads & accounting updates)
    mapping(address farmer => mapping(address token => uint256 amount))
        public totalOwedByToken;

    /// @notice Fees accumulated per token to be swept by the treasury.
    mapping(address token => uint256 amount) public pendingFees;

    // ----------- Initialization ----------- //
    /**
     * @notice Initializes the contract.
     * @param admin The address to receive DEFAULT_ADMIN/PAUSER/TREASURER by default (use a multisig Safe in prod)
     * @param treasury_ Initial treasury address
     * @param feeBps_   Initial fee in basis points (e.g., 1000 = 10%)
     * @param sequencerFeed_ Address of the L2 sequencer uptime feed (Chainlink). Use address(0) for local testing.
     */
    function initialize(
        address admin,
        address treasury_,
        uint16 feeBps_,
        address sequencerFeed_
    ) public initializer {
        if (admin == address(0)) revert AdminCannotBeZeroAddress();
        if (treasury_ == address(0)) revert TreasuryCannotBeZeroAddress();

        __UUPSUpgradeable_init();
        __AccessControlEnumerable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(TREASURER_ROLE, admin);

        uint16 initialMaxFee = 2_000; // 20%
        if (feeBps_ > initialMaxFee) revert FeeExceedsMaxFee();

        config = PoolConfig({
            treasury: treasury_,
            feeBps: feeBps_,
            withdrawalCooldown: 60, // 60 seconds by default
            maxFeeBps: initialMaxFee,
            maxSweepTokens: 50,
            maxBatches: 20,
            maxFactoriesPerWithdrawal: 50,
            sequencerUptimeFeed: sequencerFeed_
        });

        emit TreasuryUpdated(address(0), treasury_);
        emit FeeUpdated(0, feeBps_);
        emit GlobalWithdrawalCooldownUpdated(0, 60);
        emit MaxFeeBpsUpdated(0, initialMaxFee);
        emit MaxSweepTokensUpdated(0, 50);
        emit MaxBatchesUpdated(0, 20);
        emit MaxFactoriesPerWithdrawalUpdated(0, 50);
        emit SequencerUptimeFeedUpdated(address(0), sequencerFeed_);
    }

    // ----------- Admin (Treasury & Fees) ----------- //
    /**
     * @notice Sets the treasury address where fees are collected.
     * @param newTreasury The address of the new treasury.
     */
    function setTreasury(
        address newTreasury
    ) external onlyRole(TREASURER_ROLE) {
        _checkSequencerStatus();
        if (newTreasury == address(0)) revert TreasuryCannotBeZeroAddress();
        address old = config.treasury;
        config.treasury = newTreasury;
        emit TreasuryUpdated(old, newTreasury);
    }

    /**
     * @notice Sets the platform fee in basis points.
     * @param newFeeBps The new fee in basis points (e.g., 100 = 1%).
     */
    function setFeeBps(uint16 newFeeBps) external onlyRole(TREASURER_ROLE) {
        _checkSequencerStatus();
        if (newFeeBps > config.maxFeeBps) revert FeeExceedsMaxFee();
        uint16 old = config.feeBps;
        config.feeBps = newFeeBps;
        emit FeeUpdated(old, newFeeBps);
    }

    /**
     * @notice Sets the maximum platform fee that can be configured.
     * @param newMaxFeeBps The new maximum fee in basis points.
     */
    function setMaxFeeBps(
        uint16 newMaxFeeBps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _checkSequencerStatus();
        if (newMaxFeeBps > ABSOLUTE_MAX_FEE_BPS) revert FeeExceedsMaxFee();
        uint16 oldMaxFeeBps = config.maxFeeBps;
        config.maxFeeBps = newMaxFeeBps;
        emit MaxFeeBpsUpdated(oldMaxFeeBps, newMaxFeeBps);
    }

    /**
     * @notice Sets the maximum number of tokens that can be swept in a single `sweepFees` call.
     * @param newMaxSweepTokens The new maximum number of tokens.
     */
    function setMaxSweepTokens(
        uint8 newMaxSweepTokens
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _checkSequencerStatus();
        if (
            newMaxSweepTokens > ABSOLUTE_MAX_SWEEP_TOKENS ||
            newMaxSweepTokens == 0
        ) revert TooManyTokensInSweep();
        uint8 oldMax = config.maxSweepTokens;
        config.maxSweepTokens = newMaxSweepTokens;
        emit MaxSweepTokensUpdated(oldMax, newMaxSweepTokens);
    }

    /**
     * @notice Sets the maximum number of batches in a single `withdrawBatch` call.
     * @param newMaxBatches The new maximum number of batches.
     */
    function setMaxBatches(
        uint8 newMaxBatches
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _checkSequencerStatus();
        if (newMaxBatches > ABSOLUTE_MAX_BATCHES || newMaxBatches == 0) {
            revert TooManyBatches();
        }
        uint8 oldMax = config.maxBatches;
        config.maxBatches = newMaxBatches;
        emit MaxBatchesUpdated(oldMax, newMaxBatches);
    }

    /**
     * @notice Sets the maximum number of factories per withdrawal.
     * @param newMaxFactories The new maximum number of factories.
     */
    function setMaxFactoriesPerWithdrawal(
        uint8 newMaxFactories
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _checkSequencerStatus();
        if (
            newMaxFactories > ABSOLUTE_MAX_FACTORIES_PER_WITHDRAWAL ||
            newMaxFactories == 0
        ) {
            revert TooManyFactories();
        }
        uint8 oldMax = config.maxFactoriesPerWithdrawal;
        config.maxFactoriesPerWithdrawal = newMaxFactories;
        emit MaxFactoriesPerWithdrawalUpdated(oldMax, newMaxFactories);
    }

    /**
     * @notice Sets the L2 sequencer uptime feed address. Must not be the zero address.
     * @param newFeed The address of the new feed contract.
     */
    function setSequencerUptimeFeed(
        address newFeed
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newFeed == address(0)) revert FeedCannotBeZeroAddress();
        _checkSequencerStatus(); // Check with the old feed before updating
        address oldFeed = config.sequencerUptimeFeed;
        config.sequencerUptimeFeed = newFeed;
        emit SequencerUptimeFeedUpdated(oldFeed, newFeed);
    }

    /// @notice Allows the treasury to sweep accumulated fees for multiple tokens.
    /// @dev This approach prevents farmer withdrawals from failing if the treasury contract
    ///      cannot receive ETH or reverts for any reason. The treasurer can call this function
    ///      to collect fees at their convenience.
    /// @param tokensToSweep An array of token addresses for which to sweep the fees. Must not exceed config.maxSweepTokens.
    function sweepFees(
        address[] calldata tokensToSweep
    ) external nonReentrant onlyRole(TREASURER_ROLE) {
        _checkSequencerStatus();
        if (tokensToSweep.length > config.maxSweepTokens) {
            revert TooManyTokensInSweep();
        }
        if (config.treasury == address(0)) revert TreasuryNotSet();

        for (uint256 i = 0; i < tokensToSweep.length; ++i) {
            address token = tokensToSweep[i];
            uint256 amount = pendingFees[token];

            if (amount == 0) {
                continue;
            }

            // Effects-first pattern: Reset pending amount before the external call.
            pendingFees[token] = 0;

            if (token == NATIVE_TOKEN) {
                _sweepNativeFee(amount);
            } else {
                _sweepERC20Fee(token, amount);
            }
        }
    }

    /// @notice Set global withdrawal cooldown period
    /// @param newCooldown New cooldown period in seconds
    function setWithdrawalCooldown(
        uint256 newCooldown
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _checkSequencerStatus();
        uint256 oldCooldown = config.withdrawalCooldown;
        config.withdrawalCooldown = newCooldown;
        emit GlobalWithdrawalCooldownUpdated(oldCooldown, newCooldown);
    }

    /// @notice Set cooldown period for a specific token
    /// @param token Token address (address(0) for native ETH)
    /// @param cooldownSeconds Cooldown period in seconds
    function setTokenCooldown(
        address token,
        uint256 cooldownSeconds
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _checkSequencerStatus();
        uint256 oldCooldown = tokenSpecificCooldown[token];
        tokenSpecificCooldown[token] = cooldownSeconds;
        emit TokenCooldownUpdated(token, oldCooldown, cooldownSeconds);
    }

    /// @notice Recovers ERC-20 tokens that have been mistakenly sent to this contract.
    /// @dev This is a critical administrative function. It should only be used for recovery purposes,
    ///      as misuse could disrupt the contract's accounting of funds intended for rewards.
    ///      It allows transferring any amount of a given ERC-20 token from this contract's balance.
    /// @param token The address of the ERC-20 token to recover. Must not be the native token address.
    /// @param to The address to which the recovered tokens will be sent.
    /// @param amount The amount of tokens to recover.
    function recoverERC20(
        address token,
        address to,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _checkSequencerStatus();
        // Disallow recovering the native token or sending to the zero address.
        if (token == NATIVE_TOKEN) revert TokenCannotBeZeroAddress();
        if (to == address(0)) revert ReceiverCannotBeZeroAddress();
        if (amount == 0) return; // No operation needed if amount is zero.

        IERC20(token).safeTransfer(to, amount);
        emit TokensRecovered(token, to, amount);
    }

    /// @notice Get effective cooldown for a token (token-specific or global default)
    /// @param token Token address
    /// @return cooldown Effective cooldown period in seconds
    function getEffectiveCooldown(
        address token
    ) public view returns (uint256 cooldown) {
        cooldown = tokenSpecificCooldown[token];
        if (cooldown == 0) {
            cooldown = config.withdrawalCooldown; // Fall back to global default
        }
    }

    /**
     * @notice Pauses the contract, preventing key actions like funding and withdrawals.
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _checkSequencerStatus();
        _pause();
    }
    /**
     * @notice Unpauses the contract, resuming normal operations.
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _checkSequencerStatus();
        _unpause();
    }

    // ----------- Factory Funding & Reward Recording ----------- //
    /// @notice Factory deposits ERC20 reward tokens into the pool. Requires prior ERC20 approval.
    /// @dev    IMPORTANT: Only supports standard ERC-20 tokens without transfer fees or rebasing.
    ///         Measures actual balance received to handle edge cases with non-standard tokens.
    ///         Reverts if the token exhibits non-standard behavior (e.g., transfer fees > 0.1%).
    /// @param token Token address (must be standard ERC-20 without fees/rebasing)
    /// @param amount Expected amount to transfer
    function fundFactory(
        address token,
        uint256 amount
    ) external whenNotPaused onlyRole(FACTORY_ROLE) {
        _checkSequencerStatus();
        if (token == address(0)) revert TokenCannotBeZeroAddress();
        if (amount == 0) return; // no-op

        // Record balance before transfer to measure actual amount received
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));

        // Transfer tokens from factory
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Calculate actual amount received (handles fee-on-transfer tokens)
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));
        uint256 actualAmount = balanceAfter - balanceBefore;

        // Security check: Ensure the token doesn't have excessive transfer fees
        // Allow for small rounding errors (0.1% tolerance)
        uint256 maxAllowedFee = amount / 1000; // 0.1%
        if (amount > actualAmount + maxAllowedFee) {
            revert UnsupportedToken();
        }

        // Only credit the actual amount received
        factoryFunding[msg.sender][token] += actualAmount;

        emit FactoryFunded(msg.sender, token, amount, actualAmount);
    }

    /// @notice Factory deposits native ETH into the pool.
    function fundFactoryNative()
        external
        payable
        whenNotPaused
        onlyRole(FACTORY_ROLE)
    {
        _checkSequencerStatus();
        if (msg.value == 0) return;
        factoryFunding[msg.sender][NATIVE_TOKEN] += msg.value;
        emit FactoryFunded(msg.sender, NATIVE_TOKEN, msg.value, msg.value);
    }

    /**
     * @notice Factory can refund unused ERC20 funding (i.e., tokens not yet allocated to farmers).
     * @param token The address of the ERC20 token to refund.
     * @param amount The amount of tokens to refund.
     */
    function refundFactory(
        address token,
        uint256 amount
    ) external nonReentrant whenNotPaused onlyRole(FACTORY_ROLE) {
        _checkSequencerStatus();
        if (token == address(0)) revert TokenCannotBeZeroAddress();
        mapping(address => uint256) storage fundingByToken = factoryFunding[
            msg.sender
        ];
        uint256 bal = fundingByToken[token];
        if (bal < amount) revert InsufficientFactoryFunds();
        unchecked {
            fundingByToken[token] = bal - amount;
        }
        IERC20(token).safeTransfer(msg.sender, amount);
        emit FactoryRefunded(msg.sender, token, amount);
    }

    /**
     * @notice Factory can refund unused native ETH funding.
     * @param amount The amount of native ETH to refund.
     */
    function refundFactoryNative(
        uint256 amount
    ) external nonReentrant whenNotPaused onlyRole(FACTORY_ROLE) {
        _checkSequencerStatus();
        mapping(address => uint256) storage fundingByToken = factoryFunding[
            msg.sender
        ];
        uint256 bal = fundingByToken[NATIVE_TOKEN];
        if (bal < amount) revert InsufficientFactoryFunds();
        unchecked {
            fundingByToken[NATIVE_TOKEN] = bal - amount;
        }
        Address.sendValue(payable(msg.sender), amount);
        emit FactoryRefunded(msg.sender, NATIVE_TOKEN, amount);
    }

    /// @notice Record reward with unique task ID to prevent duplicate rewards for the same task
    /// @dev    ONLY secure method to record rewards - prevents duplicate task completion
    /// @param farmer Address receiving the reward
    /// @param token Token address (or address(0) for ETH)
    /// @param amount Reward amount
    /// @param taskId Unique identifier for the completed task
    function recordReward(
        address farmer,
        address token,
        uint256 amount,
        bytes32 taskId
    ) external whenNotPaused onlyRole(FACTORY_ROLE) {
        _checkSequencerStatus();
        if (farmer == address(0)) revert FarmerCannotBeZeroAddress();
        if (taskId == bytes32(0)) revert InvalidTaskId();
        if (amount == 0) return; // no-op

        // Check if task was already completed (prevents duplicate rewards)
        if (completedTasks[taskId]) revert TaskAlreadyCompleted();

        // Mark task as completed FIRST (effects-first pattern)
        completedTasks[taskId] = true;

        // Check factory has sufficient funding and update its balance.
        mapping(address => uint256) storage fundingByToken = factoryFunding[
            msg.sender
        ];
        uint256 bal = fundingByToken[token];
        if (bal < amount) revert InsufficientFactoryFunds();
        unchecked {
            fundingByToken[token] = bal - amount;
        }

        // Update farmer rewards
        bytes32 accruedKey = _getAccruedKey(farmer, msg.sender, token);
        accrued[accruedKey] += amount;
        totalOwedByToken[farmer][token] += amount;

        emit TaskValidated(taskId, farmer, msg.sender, block.number);
        emit TaskCompleted(
            taskId,
            farmer,
            msg.sender,
            token,
            amount,
            block.timestamp
        );
        emit RewardRecorded(msg.sender, farmer, token, amount, block.timestamp);
    }

    // ----------- Withdrawals (Farmer-initiated) ----------- //
    struct TokenFactoryBatch {
        address token;
        address[] factories;
    }

    /// @notice Secure withdrawal with nonce verification and rate limiting
    /// @dev    Unified secure method to withdraw - includes all security features
    /// @param token Token to withdraw
    /// @param factories List of factories to withdraw from
    /// @param expectedNonce Expected nonce (must match farmerNonce[msg.sender])
    function withdrawRewards(
        address token,
        address[] calldata factories,
        uint256 expectedNonce
    ) external nonReentrant whenNotPaused {
        _checkSequencerStatus();
        if (
            factories.length == 0 ||
            factories.length > config.maxFactoriesPerWithdrawal
        ) {
            revert TooManyFactories();
        }

        for (uint256 i = 0; i < factories.length; ++i) {
            if (factories[i] == address(0)) revert FactoryCannotBeZeroAddress();
        }

        address farmer = msg.sender;

        // Verify nonce to prevent replay attacks
        if (farmerNonce[farmer] != expectedNonce) revert InvalidNonce();

        // Rate limiting check
        uint256 effectiveCooldown = getEffectiveCooldown(token);
        if (
            block.timestamp <
            lastWithdrawalTime[farmer][token] + effectiveCooldown
        ) {
            revert WithdrawalTooSoon();
        }

        // Increment nonce BEFORE withdrawal (effects-first pattern)
        uint256 oldNonce = farmerNonce[farmer];
        farmerNonce[farmer] = oldNonce + 1;
        lastWithdrawalTime[farmer][token] = block.timestamp;

        // Perform withdrawal logic. State changes and events happen within this function.
        _executeWithdrawal(token, factories, farmer);

        // Emit nonce event after all state changes for this logical action are complete.
        // This ensures off-chain observers see a consistent state.
        emit WithdrawalNonceIncremented(farmer, oldNonce, oldNonce + 1);
    }

    /// @notice Secure batch withdraw with global nonce protection and rate limiting
    /// @dev    Unified secure method for batch operations - includes all security features
    /// @param batches Array of withdrawal batches
    /// @param expectedNonce Expected global nonce for this batch operation
    function withdrawBatch(
        TokenFactoryBatch[] calldata batches,
        uint256 expectedNonce
    ) external nonReentrant whenNotPaused {
        _checkSequencerStatus();
        if (batches.length == 0 || batches.length > config.maxBatches) {
            revert TooManyBatches();
        }
        address farmer = msg.sender;

        // Verify global nonce
        if (farmerNonce[farmer] != expectedNonce) revert InvalidNonce();

        // Pre-check rate limiting for all tokens in the batch
        for (uint256 i = 0; i < batches.length; ++i) {
            if (
                batches[i].factories.length == 0 ||
                batches[i].factories.length > config.maxFactoriesPerWithdrawal
            ) {
                revert TooManyFactories();
            }
            for (uint256 j = 0; j < batches[i].factories.length; ++j) {
                if (batches[i].factories[j] == address(0)) {
                    revert FactoryCannotBeZeroAddress();
                }
            }
            uint256 effectiveCooldown = getEffectiveCooldown(batches[i].token);
            // solhint-disable-next-line gas-strict-inequalities
            if (
                block.timestamp <
                lastWithdrawalTime[farmer][batches[i].token] + effectiveCooldown
            ) {
                revert WithdrawalTooSoon();
            }
        }

        // Increment nonce for batch operation
        uint256 oldNonce = farmerNonce[farmer];
        farmerNonce[farmer] = oldNonce + 1;

        // Effects: Update all timestamps before any external calls to follow
        // the Checks-Effects-Interactions pattern and mitigate potential reentrancy-related race conditions.
        for (uint256 i = 0; i < batches.length; ++i) {
            lastWithdrawalTime[farmer][batches[i].token] = block.timestamp;
        }

        // Interactions: Process each withdrawal now that all state changes are complete.
        for (uint256 i = 0; i < batches.length; ++i) {
            _executeWithdrawal(batches[i].token, batches[i].factories, farmer);
        }

        // Emit nonce event after all state changes for this logical action are complete.
        emit WithdrawalNonceIncremented(farmer, oldNonce, oldNonce + 1);
    }

    /**
     * @notice Internal withdrawal logic (shared between regular and batch withdrawals).
     * @param token The token to be withdrawn.
     * @param factories The list of factories to withdraw rewards from.
     * @param farmer The farmer's address.
     */
    function _executeWithdrawal(
        address token,
        address[] calldata factories,
        address farmer
    ) internal {
        if (config.treasury == address(0)) revert TreasuryNotSet();

        uint256 gross = _calculateAndClearAccruedRewards(
            token,
            factories,
            farmer
        );

        if (gross == 0) revert NothingToWithdraw();

        mapping(address => uint256) storage owed = totalOwedByToken[farmer];
        uint256 ob = owed[token];
        if (gross > ob) revert AccountingError();
        unchecked {
            owed[token] = ob - gross;
        }

        (uint256 fee, uint256 net) = _distributeFunds(token, farmer, gross);

        emit RewardsWithdrawn(
            farmer,
            token,
            gross,
            fee,
            net,
            factories.length,
            block.timestamp
        );
    }

    // ----------- Views & Helpers ----------- //
    /**
     * @notice Gets the amount owed to a farmer by a specific factory for a given token.
     * @param farmer The address of the farmer.
     * @param factory The address of the factory.
     * @param token The address of the token.
     * @return The amount owed.
     */
    function getOwedByFactory(
        address farmer,
        address factory,
        address token
    ) external view returns (uint256) {
        if (factory == address(0)) revert FactoryCannotBeZeroAddress();
        bytes32 accruedKey = _getAccruedKey(farmer, factory, token);
        return accrued[accruedKey];
    }

    /**
     * @notice Gets the total aggregated amount owed to a farmer for a specific token across all factories.
     * @param farmer The address of the farmer.
     * @param token The address of the token.
     * @return The total amount owed.
     */
    function getOwedAggregate(
        address farmer,
        address token
    ) external view returns (uint256) {
        return totalOwedByToken[farmer][token];
    }

    /// @notice Check if farmer can withdraw specific token (cooldown check)
    /// @param farmer Farmer address
    /// @param token Token address
    /// @return canWithdrawNow True if withdrawal is allowed immediately
    /// @return nextWithdrawalTime Timestamp when next withdrawal will be allowed
    function canWithdraw(
        address farmer,
        address token
    ) external view returns (bool canWithdrawNow, uint256 nextWithdrawalTime) {
        uint256 last = lastWithdrawalTime[farmer][token];
        uint256 eff = getEffectiveCooldown(token);
        nextWithdrawalTime = last + eff;
        // solhint-disable-next-line gas-strict-inequalities
        canWithdrawNow = block.timestamp >= nextWithdrawalTime;
    }

    /// @notice Get detailed withdrawal status for a farmer and token
    /// @param farmer Farmer address
    /// @param token Token address
    /// @return canWithdrawNow True if can withdraw now
    /// @return remainingCooldown Seconds remaining in cooldown (0 if can withdraw)
    /// @return lastWithdrawTime Timestamp of last withdrawal
    function getWithdrawalStatus(
        address farmer,
        address token
    )
        external
        view
        returns (
            bool canWithdrawNow,
            uint256 remainingCooldown,
            uint256 lastWithdrawTime
        )
    {
        lastWithdrawTime = lastWithdrawalTime[farmer][token];
        uint256 effectiveCooldown = getEffectiveCooldown(token);
        uint256 nextAllowedTime = lastWithdrawTime + effectiveCooldown;

        // solhint-disable-next-line gas-strict-inequalities
        if (block.timestamp >= nextAllowedTime) {
            canWithdrawNow = true;
            remainingCooldown = 0;
        } else {
            canWithdrawNow = false;
            remainingCooldown = nextAllowedTime - block.timestamp;
        }
    }

    /// @notice Check withdrawal eligibility for multiple tokens at once
    /// @param farmer Farmer address
    /// @param tokens Array of token addresses to check
    /// @return eligibility Array of booleans indicating eligibility for each token
    function canWithdrawMultiple(
        address farmer,
        address[] calldata tokens
    ) external view returns (bool[] memory eligibility) {
        if (tokens.length > MAX_VIEW_ARRAY_LENGTH || tokens.length == 0) {
            revert ArrayTooLong();
        }
        eligibility = new bool[](tokens.length);
        uint256 currentTime = block.timestamp;

        for (uint256 i = 0; i < tokens.length; ++i) {
            uint256 effectiveCooldown = getEffectiveCooldown(tokens[i]);
            eligibility[i] =
                // solhint-disable-next-line gas-strict-inequalities
                currentTime >=
                lastWithdrawalTime[farmer][tokens[i]] + effectiveCooldown;
        }
    }

    /// @notice Check if a task has been completed
    /// @param taskId Task identifier
    /// @return bool True if task is completed
    function isTaskCompleted(bytes32 taskId) external view returns (bool) {
        return completedTasks[taskId];
    }

    /// @notice Get current nonce for a farmer
    /// @param farmer Farmer address
    /// @return uint256 Current nonce
    function getCurrentNonce(address farmer) external view returns (uint256) {
        return farmerNonce[farmer];
    }

    /**
     * @notice Check if a token looks like a standard ERC-20 (purement `view`)
     * @dev Heuristic: presence of code + `view` calls that don't revert.
     * @param token The address of the token to check.
     * @return A boolean indicating if the token is supported.
     */
    function isTokenSupported(address token) external returns (bool) {
        if (token == address(0)) return true; // Native is always supported

        // Must be a contract.
        // NOTE: extcodesize check can be bypassed by contracts during construction.
        // This is acceptable here as this is a non-critical helper function.
        // Core fund-handling functions are protected by SafeERC20 calls.
        uint256 size;
        assembly {
            size := extcodesize(token)
        }
        if (size == 0) return false;

        // Basic ERC20 `view` methods should not revert (balanceOf/totalSupply are required in ERC-20)
        try IERC20(token).totalSupply() returns (uint256) {
            /* solhint-disable-next-line no-empty-blocks */
        } catch (bytes memory reason) {
            emit TokenCheckFailed(token, "isSupported-totalSupply", reason);
            return false;
        }
        try IERC20(token).balanceOf(address(this)) returns (uint256) {
            /* solhint-disable-next-line no-empty-blocks */
        } catch (bytes memory reason) {
            emit TokenCheckFailed(token, "isSupported-balanceOf", reason);
            return false;
        }

        return true;
    }

    /// @notice Test token compatibility with a small amount
    /// @dev    WARNING: This function transfers a small amount of tokens to test compatibility.
    ///         Only call with tokens you trust and have approved for this contract.
    /// @param token Token address to test
    /// @param testAmount Small amount to test (recommend 1 wei or 1 token unit)
    /// @return bool True if token behaves as expected
    /// @return uint256 Actual amount received
    function testTokenCompatibility(
        address token,
        uint256 testAmount
    ) external returns (bool, uint256) {
        if (token == address(0)) return (true, 0); // Native ETH

        uint256 balanceBefore = IERC20(token).balanceOf(address(this));

        try
            IERC20(token).transferFrom(msg.sender, address(this), testAmount)
        returns (bool success) {
            if (!success) {
                emit TokenCheckFailed(
                    token,
                    "testCompatibility-transferFrom",
                    "returned false"
                );
                return (false, 0);
            }

            uint256 balanceAfter = IERC20(token).balanceOf(address(this));
            uint256 actualReceived = balanceAfter - balanceBefore;

            // Return tokens to sender
            IERC20(token).safeTransfer(msg.sender, actualReceived);

            return (true, actualReceived);
        } catch (bytes memory reason) {
            emit TokenCheckFailed(
                token,
                "testCompatibility-transferFrom",
                reason
            );
            return (false, 0);
        }
    }

    // ----------- UUPS ----------- //
    /**
     * @notice Authorizes an upgrade to a new implementation contract.
     * @dev Only the address with `DEFAULT_ADMIN_ROLE` can authorize an upgrade.
     *      This function is required by the UUPS upgradeable pattern.
     * @param newImplementation The address of the new implementation contract.
     */
    function _authorizeUpgrade(
        address newImplementation
    ) internal view override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newImplementation == address(0)) revert InvalidNewImplementation();
        // Intentionally left blank to allow admin control.
    }

    // ----------- ETH receive guard ----------- //
    /**
     * @notice Prevents accidental direct ETH transfers. Ether should be sent via `fundFactoryNative`.
     */
    receive() external payable {
        revert DirectEthNotAllowed();
    }

    // ----------- Storage gap ----------- //
    uint256[35] private __gap;

    // ----------- Private Helpers ----------- //

    /**
     * @notice Calculates the total rewards for a given set of factories and clears them.
     * @param token The token address.
     * @param factories The list of factories to calculate rewards from.
     * @param farmer The farmer's address.
     * @return gross The total gross amount of rewards.
     */
    function _calculateAndClearAccruedRewards(
        address token,
        address[] calldata factories,
        address farmer
    ) private returns (uint256 gross) {
        uint256 len = factories.length;
        for (uint256 i; i < len; ) {
            address f = factories[i];
            bytes32 accruedKey = _getAccruedKey(farmer, f, token);
            uint256 amt = accrued[accruedKey];

            if (amt != 0) {
                delete accrued[accruedKey];
                gross += amt;
            }

            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Distributes funds to the farmer and treasury after calculating fees.
     * @dev Calculates fees and net amount, then distributes funds to farmer and buffers fees for treasury.
     * @param token The token address.
     * @param farmer The farmer's address.
     * @param gross The gross amount to distribute.
     * @return fee The calculated fee amount.
     * @return net The net amount for the farmer.
     */
    function _distributeFunds(
        address token,
        address farmer,
        uint256 gross
    ) private returns (uint256 fee, uint256 net) {
        // Fee calculation using integer division with rounding up.
        fee = (gross * config.feeBps + MAX_BPS - 1) / MAX_BPS;
        net = gross - fee;

        // --- CEI Pattern: Effects before Interactions ---
        if (fee != 0) {
            pendingFees[token] += fee;
        }

        // --- Interactions ---
        if (net > 0) {
            if (token == NATIVE_TOKEN) {
                // send ETH
                Address.sendValue(payable(farmer), net);
            } else {
                // send ERC20
                IERC20(token).safeTransfer(farmer, net);
            }
        }
    }

    /**
     * @notice Computes the storage key for the `accrued` mapping.
     * @param farmer The farmer's address.
     * @param factory The factory's address.
     * @param token The token's address.
     * @return The keccak256 hash used as a key.
     */
    function _getAccruedKey(
        address farmer,
        address factory,
        address token
    ) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(farmer, factory, token));
    }

    // --- Fee Sweep Helpers ---

    /**
     * @notice Sweeps pending native ETH fees to the treasury.
     * @param amount The amount of native ETH to sweep.
     */
    function _sweepNativeFee(uint256 amount) private {
        // Use .call to send ETH without reverting the entire transaction if it fails.
        (bool success, ) = config.treasury.call{value: amount}("");
        if (success) {
            emit FeeSwept(NATIVE_TOKEN, config.treasury, amount);
        } else {
            // If the transfer fails, restore the pending amount so it can be tried again.
            // This is safe from reentrancy due to the nonReentrant guard on the public calling function.
            pendingFees[NATIVE_TOKEN] = amount;
            emit FeeSweepFailed(NATIVE_TOKEN, config.treasury, amount);
        }
    }

    /**
     * @notice Sweeps pending ERC20 fees to the treasury.
     * @param token The address of the ERC20 token to sweep.
     * @param amount The amount of the token to sweep.
     */
    function _sweepERC20Fee(address token, uint256 amount) private {
        // For ERC20s, use a low-level call to prevent a single failing
        // token from reverting the entire batch sweep (DoS vector).
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory returnData) = token.call(
            abi.encodeWithSelector(
                IERC20.transfer.selector,
                config.treasury,
                amount
            )
        );
        // Replicate SafeERC20's check for success and true return value
        if (
            success &&
            (returnData.length == 0 || abi.decode(returnData, (bool)))
        ) {
            emit FeeSwept(token, config.treasury, amount);
        } else {
            // If the transfer fails, restore the pending amount so it can be tried again.
            // This is safe from reentrancy due to the nonReentrant guard on the public calling function.
            // solhint-disable-next-line reentrancy
            pendingFees[token] = amount;
            emit FeeSweepFailed(token, config.treasury, amount);
        }
    }
}

/**
 * @title IAggregatorV3Interface
 * @notice Interface for the Chainlink Aggregator V3.
 * @author Chainlink
 */
interface IAggregatorV3Interface {
    /**
     * @notice Get the number of decimals for the price feed.
     * @return The number of decimals.
     */
    function decimals() external view returns (uint8);

    /**
     * @notice Get a description of the price feed.
     * @return The description string.
     */
    function description() external view returns (string memory);

    /**
     * @notice Get the version of the price feed.
     * @return The version number.
     */
    function version() external view returns (uint256);

    /**
     * @notice Get the data for a specific round.
     * @param _roundId The ID of the round to retrieve.
     * @return roundId The round ID.
     * @return answer The price.
     * @return startedAt Timestamp of when the round started.
     * @return updatedAt Timestamp of when the round was updated.
     * @return answeredInRound The round ID in which the answer was computed.
     */
    function getRoundData(
        uint80 _roundId
    )
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );

    /**
     * @notice Get the latest round data.
     * @return roundId The round ID.
     * @return answer The price.
     * @return startedAt Timestamp of when the round started.
     * @return updatedAt Timestamp of when the round was updated.
     * @return answeredInRound The round ID in which the answer was computed.
     */
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}
