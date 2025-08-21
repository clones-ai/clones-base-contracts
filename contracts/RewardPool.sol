// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title RewardPool (UUPS Upgradeable)
 * @notice Centralized reward pool for multiple factories. Farmers withdraw their rewards and pay gas.
 *         A platform fee is skimmed on each withdrawal and sent to the treasury. Supports multiple ERC20 tokens
 *         and native ETH on Base.
 * @dev    Designed for Base L2. Uses OZ v5.x upgradeable contracts.
 *         Enhanced with Task ID system and Nonce-based withdrawals for maximum security.
 * @custom:security-contact security@clones.ai
 */

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import {SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {AddressUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";

contract RewardPool is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // ----------- Roles ----------- //
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
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

    // ----------- Events ----------- //
    event TreasuryUpdated(
        address indexed oldTreasury,
        address indexed newTreasury
    );
    event FeeUpdated(uint16 oldFeeBps, uint16 newFeeBps);

    event FactoryFunded(
        address indexed factory,
        address indexed token,
        uint256 amount
    );
    event FactoryRefunded(
        address indexed factory,
        address indexed token,
        uint256 amount
    );

    event RewardRecorded(
        address indexed factory,
        address indexed farmer,
        address indexed token,
        uint256 amount,
        uint256 timestamp
    );

    event TaskCompleted(
        bytes32 indexed taskId,
        address indexed farmer,
        address indexed factory,
        address token,
        uint256 amount,
        uint256 timestamp
    );

    event TaskValidated(
        bytes32 indexed taskId,
        address indexed farmer,
        address indexed factory,
        uint256 blockNumber,
        bytes32 blockHash
    );

    event RewardsWithdrawn(
        address indexed farmer,
        address indexed token, // address(0) => native ETH
        uint256 grossAmount,
        uint256 feeAmount,
        uint256 netAmount,
        uint256 factoryCount,
        uint256 timestamp
    );

    event WithdrawalNonceIncremented(
        address indexed farmer,
        uint256 oldNonce,
        uint256 newNonce
    );

    // ----------- Constants ----------- //
    uint16 public constant MAX_BPS = 10_000; // 100%
    uint16 public constant MAX_FEE_BPS = 2_000; // Safety cap: 20%
    address public constant NATIVE_TOKEN = address(0); // sentinel for ETH

    // ----------- Config ----------- //
    address public treasury; // where fees are sent
    uint16 public feeBps; // platform fee in basis points (e.g., 1000 = 10%)

    // ----------- Security Features ----------- //
    /// @notice Global nonce for each farmer (incremented on each withdrawal)
    mapping(address farmer => uint256 nonce) public farmerNonce;

    /// @notice Tracks completed tasks to prevent duplicate rewards
    mapping(bytes32 taskId => bool completed) public completedTasks;

    /// @notice Timestamp of last withdrawal per farmer/token (for rate limiting)
    mapping(address farmer => mapping(address token => uint256 lastWithdrawal))
        public lastWithdrawalTime;

    /// @notice Minimum delay between withdrawals of the same token (configurable)
    uint256 public withdrawalCooldown = 60; // 60 seconds by default

    /// @notice Set different cooldown periods for different tokens
    mapping(address token => uint256 cooldown) public tokenSpecificCooldown;

    // ----------- Accounting ----------- //
    // Tokens deposited by each factory into the pool that are not yet allocated to farmers
    mapping(address factory => mapping(address token => uint256 amount))
        public factoryFunding;

    // Accrued rewards per farmer per factory per token (auditable source of truth)
    mapping(address farmer => mapping(address factory => mapping(address token => uint256 amount)))
        public accrued;

    // Aggregated owed per farmer per token (gas-friendly for reads & accounting updates)
    mapping(address farmer => mapping(address token => uint256 amount))
        public totalOwedByToken;

    // ----------- Initialization ----------- //
    /// @param admin The address to receive DEFAULT_ADMIN/PAUSER/TREASURER by default (use a multisig Safe in prod)
    /// @param treasury_ Initial treasury address
    /// @param feeBps_   Initial fee in basis points (e.g., 1000 = 10%)
    function initialize(
        address admin,
        address treasury_,
        uint16 feeBps_
    ) public initializer {
        if (admin == address(0) || treasury_ == address(0))
            revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert InvalidFee();

        __UUPSUpgradeable_init();
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(TREASURER_ROLE, admin);

        treasury = treasury_;
        feeBps = feeBps_;

        emit TreasuryUpdated(address(0), treasury_);
        emit FeeUpdated(0, feeBps_);
    }

    // ----------- Admin (Treasury & Fees) ----------- //
    function setTreasury(
        address newTreasury
    ) external onlyRole(TREASURER_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        address old = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(old, newTreasury);
    }

    function setFeeBps(uint16 newFeeBps) external onlyRole(TREASURER_ROLE) {
        if (newFeeBps > MAX_FEE_BPS) revert InvalidFee();
        uint16 old = feeBps;
        feeBps = newFeeBps;
        emit FeeUpdated(old, newFeeBps);
    }

    /// @notice Set global withdrawal cooldown period
    /// @param newCooldown New cooldown period in seconds
    function setWithdrawalCooldown(
        uint256 newCooldown
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        withdrawalCooldown = newCooldown;
    }

    event TokenCooldownUpdated(
        address indexed token,
        uint256 oldCooldown,
        uint256 newCooldown
    );

    /// @notice Set cooldown period for a specific token
    /// @param token Token address (address(0) for native ETH)
    /// @param cooldownSeconds Cooldown period in seconds
    function setTokenCooldown(
        address token,
        uint256 cooldownSeconds
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldCooldown = tokenSpecificCooldown[token];
        tokenSpecificCooldown[token] = cooldownSeconds;
        emit TokenCooldownUpdated(token, oldCooldown, cooldownSeconds);
    }

    /// @notice Get effective cooldown for a token (token-specific or global default)
    /// @param token Token address
    /// @return cooldown Effective cooldown period in seconds
    function getEffectiveCooldown(
        address token
    ) public view returns (uint256 cooldown) {
        cooldown = tokenSpecificCooldown[token];
        if (cooldown == 0) {
            cooldown = withdrawalCooldown; // Fall back to global default
        }
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ----------- Factory Funding & Reward Recording ----------- //
    /// @notice Factory deposits ERC20 reward tokens into the pool. Requires prior ERC20 approval.
    function fundFactory(
        address token,
        uint256 amount
    ) external whenNotPaused onlyRole(FACTORY_ROLE) {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) return; // no-op
        factoryFunding[msg.sender][token] += amount;
        IERC20Upgradeable(token).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        );
        emit FactoryFunded(msg.sender, token, amount);
    }

    /// @notice Factory deposits native ETH into the pool.
    function fundFactoryNative()
        external
        payable
        whenNotPaused
        onlyRole(FACTORY_ROLE)
    {
        if (msg.value == 0) return;
        factoryFunding[msg.sender][NATIVE_TOKEN] += msg.value;
        emit FactoryFunded(msg.sender, NATIVE_TOKEN, msg.value);
    }

    /// @notice Factory can refund unused ERC20 funding (i.e., tokens not yet allocated to farmers).
    function refundFactory(
        address token,
        uint256 amount
    ) external whenNotPaused onlyRole(FACTORY_ROLE) {
        if (token == address(0)) revert ZeroAddress();
        uint256 available = factoryFunding[msg.sender][token];
        if (amount > available) revert InsufficientFactoryFunds();
        factoryFunding[msg.sender][token] = available - amount;
        IERC20Upgradeable(token).safeTransfer(msg.sender, amount);
        emit FactoryRefunded(msg.sender, token, amount);
    }

    /// @notice Factory can refund unused native ETH funding.
    function refundFactoryNative(
        uint256 amount
    ) external whenNotPaused onlyRole(FACTORY_ROLE) {
        uint256 available = factoryFunding[msg.sender][NATIVE_TOKEN];
        if (amount > available) revert InsufficientFactoryFunds();
        factoryFunding[msg.sender][NATIVE_TOKEN] = available - amount;
        AddressUpgradeable.sendValue(payable(msg.sender), amount);
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
        if (farmer == address(0)) revert ZeroAddress();
        if (taskId == bytes32(0)) revert InvalidTaskId();
        if (amount == 0) return; // no-op

        // Check if task was already completed (prevents duplicate rewards)
        if (completedTasks[taskId]) revert TaskAlreadyCompleted();

        // Mark task as completed FIRST (effects-first pattern)
        completedTasks[taskId] = true;

        // Check factory has sufficient funding
        uint256 available = factoryFunding[msg.sender][token];
        if (available < amount) revert InsufficientFactoryFunds();
        factoryFunding[msg.sender][token] = available - amount;

        // Update farmer rewards
        accrued[farmer][msg.sender][token] += amount;
        totalOwedByToken[farmer][token] += amount;

        emit TaskValidated(
            taskId,
            farmer,
            msg.sender,
            block.number,
            blockhash(block.number - 1)
        );
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

        emit WithdrawalNonceIncremented(farmer, oldNonce, oldNonce + 1);

        // Perform withdrawal logic
        _executeWithdrawal(token, factories, farmer);
    }

    /// @notice Secure batch withdraw with global nonce protection and rate limiting
    /// @dev    Unified secure method for batch operations - includes all security features
    /// @param batches Array of withdrawal batches
    /// @param expectedNonce Expected global nonce for this batch operation
    function withdrawBatch(
        TokenFactoryBatch[] calldata batches,
        uint256 expectedNonce
    ) external nonReentrant whenNotPaused {
        address farmer = msg.sender;

        // Verify global nonce
        if (farmerNonce[farmer] != expectedNonce) revert InvalidNonce();

        // Pre-check rate limiting for all tokens in the batch
        for (uint256 i = 0; i < batches.length; i++) {
            uint256 effectiveCooldown = getEffectiveCooldown(batches[i].token);
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

        emit WithdrawalNonceIncremented(farmer, oldNonce, oldNonce + 1);

        // Process each withdrawal in the batch
        for (uint256 i = 0; i < batches.length; i++) {
            // Update timestamp for rate limiting
            lastWithdrawalTime[farmer][batches[i].token] = block.timestamp;
            // Execute withdrawal
            _executeWithdrawal(batches[i].token, batches[i].factories, farmer);
        }
    }

    /// @notice Internal withdrawal logic (shared between regular and batch withdrawals)
    function _executeWithdrawal(
        address token,
        address[] calldata factories,
        address farmer
    ) internal {
        if (treasury == address(0)) revert TreasuryNotSet();

        uint256 gross;

        unchecked {
            for (uint256 i = 0; i < factories.length; i++) {
                address f = factories[i];
                uint256 amt = accrued[farmer][f][token];
                if (amt == 0) continue;
                accrued[farmer][f][token] = 0; // effects first
                gross += amt;
            }
        }

        if (gross == 0) revert NothingToWithdraw();

        // Update aggregate before external calls
        uint256 currentOwed = totalOwedByToken[farmer][token];
        totalOwedByToken[farmer][token] = currentOwed - gross; // underflow impossible

        uint256 fee = (gross * feeBps) / MAX_BPS;
        uint256 net = gross - fee;

        if (token == NATIVE_TOKEN) {
            // send ETH
            AddressUpgradeable.sendValue(payable(farmer), net);
            if (fee != 0) AddressUpgradeable.sendValue(payable(treasury), fee);
        } else {
            // send ERC20
            IERC20Upgradeable(token).safeTransfer(farmer, net);
            if (fee != 0) IERC20Upgradeable(token).safeTransfer(treasury, fee);
        }

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
    function getOwedByFactory(
        address farmer,
        address factory,
        address token
    ) external view returns (uint256) {
        return accrued[farmer][factory][token];
    }

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
        eligibility = new bool[](tokens.length);
        uint256 currentTime = block.timestamp;

        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 effectiveCooldown = getEffectiveCooldown(tokens[i]);
            eligibility[i] =
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

    // ----------- UUPS ----------- //
    function _authorizeUpgrade(
        address
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    // ----------- ETH receive guard ----------- //
    /// @dev Prevent accidental direct ETH transfers that would not be accounted as factory funding.
    receive() external payable {
        revert DirectEthNotAllowed();
    }

    // ----------- Storage gap ----------- //
    uint256[35] private __gap;
}
