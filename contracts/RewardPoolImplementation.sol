// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IRewardPoolImplementation} from "./RewardPoolFactory.sol";
import {IVaultClaim} from "./ClaimRouter.sol";

/**
 * @title RewardPoolImplementation
 * @notice Individual reward vault implementation using cumulative EIP-712 signature pattern
 * @dev Logic contract for EIP-1167 clones with centralized governance via factory
 * @custom:security-contact security@clones.ai
 * @author CLONES
 */
// solhint-disable-next-line mark-callable-contracts
contract RewardPoolImplementation is
    Initializable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    EIP712Upgradeable,
    ERC165Upgradeable,
    IRewardPoolImplementation,
    IVaultClaim
{
    using SafeERC20 for IERC20;

    // ----------- Custom Errors ----------- //
    error InvalidParameter(string param);
    error Unauthorized(string role);
    error AlreadyExists(string resource);
    error SecurityViolation(string check);

    // ----------- Constants ----------- //
    /// @notice Platform fee in basis points (10%)
    uint16 public constant FEE_BPS = 1000; // 10% fixed globally
    /// @notice Grace period for publisher rotation
    uint256 public constant PUBLISHER_GRACE_PERIOD = 7 days;
    /// @notice Grace period before emergency sweep can be executed
    uint256 public constant EMERGENCY_SWEEP_GRACE_PERIOD = 180 days;

    uint256 private constant FEE_DENOMINATOR = 10000;
    uint256 private constant FEE_MULTIPLIER = FEE_BPS;

    // ----------- State Variables ----------- //
    struct PoolConfig {
        address token; // 20 bytes
        address platformTreasury; // 20 bytes
        address factory; // 20 bytes - overflow to slot 1
        uint64 lastClaimTimestamp; // 8 bytes - fits in slot 1
    }
    /// @notice Pool configuration struct containing token, treasury, factory addresses and timestamp
    PoolConfig public poolConfig;

    // Cumulative claim tracking
    /// @notice Tracks cumulative amount already claimed per account
    mapping(address => uint256) public alreadyClaimed; // Cumulative amount already claimed
    /// @notice Tracks cumulative fees already paid per account
    mapping(address => uint256) public alreadyFeePaid; // Cumulative fees already paid by account
    /// @notice Total amount already claimed by all users
    uint256 public globalAlreadyClaimed; // Total amount already claimed by all users

    // Emergency sweep state
    /// @notice Timestamp when emergency sweep notice was initiated
    uint256 public emergencyNoticeTimestamp; // On-chain notice timestamp
    /// @notice Mandatory notice period before emergency sweep can be executed
    uint256 public constant EMERGENCY_NOTICE_PERIOD = 7 days; // Mandatory notice period

    // ----------- Modifiers ----------- //
    modifier onlyFactoryTimelock() {
        if (msg.sender != IRewardPoolFactory(poolConfig.factory).timelock()) revert Unauthorized("timelock");
        _;
    }

    modifier onlyFactoryGuardian() {
        if (msg.sender != IRewardPoolFactory(poolConfig.factory).guardian()) revert Unauthorized("guardian");
        _;
    }

    // ----------- Constructor ----------- //
    /// @notice Constructor disables initializers to prevent direct initialization
    constructor() {
        // Disable initializers on implementation to prevent direct initialization
        _disableInitializers();
    }

    // ----------- Initialization ----------- //
    /**
     * @notice Initialize the vault clone
     * @param token_ Token address for rewards
     * @param platformTreasury_ Treasury address for fees
     * @param factory_ Factory address for governance
     */
    function initialize(address token_, address platformTreasury_, address factory_) external initializer {
        if (token_ == address(0)) revert InvalidParameter("token");
        if (platformTreasury_ == address(0)) revert InvalidParameter("treasury");
        if (factory_ == address(0)) revert InvalidParameter("factory");

        // Initialize inherited contracts (NO AccessControl)
        __Pausable_init();
        __ReentrancyGuard_init();
        __EIP712_init("FactoryVault", "1");

        // Set contract state
        poolConfig = PoolConfig({
            token: token_,
            platformTreasury: platformTreasury_,
            factory: factory_,
            lastClaimTimestamp: uint64(block.timestamp)
        });

        // Creator gets no special roles (factory creates pools, not direct admin)
    }

    // ----------- Funding Functions ----------- //
    /**
     * @notice Fund the vault with tokens
     * @param amount Amount to fund
     */
    function fund(uint256 amount) external nonReentrant whenNotPaused {
        _performFund(amount);
    }

    /**
     * @notice Internal function to perform funding with anti fee-on-transfer check
     * @param amount Amount to fund
     */
    function _performFund(uint256 amount) internal {
        // Anti fee-on-transfer: verify actual amount received
        IERC20 tokenContract = IERC20(poolConfig.token);
        uint256 balanceBefore = tokenContract.balanceOf(address(this));
        tokenContract.safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = tokenContract.balanceOf(address(this));

        uint256 actualReceived = balanceAfter - balanceBefore;
        if (actualReceived != amount) revert SecurityViolation("token_transfer");

        emit Funded(msg.sender, poolConfig.token, amount);
    }

    /**
     * @notice Fund with EIP-2612 permit
     * @param amount Amount to fund
     * @param deadline Permit deadline
     * @param v Signature v
     * @param r Signature r
     * @param s Signature s
     */
    function fundWithPermit(
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused {
        // CRITICAL: Permit support is fragile across USDC variants - handle gracefully
        IERC20 tokenContract = IERC20(poolConfig.token);
        try IERC20Permit(poolConfig.token).permit(msg.sender, address(this), amount, deadline, v, r, s) {
            // POST-CHECK: Verify allowance was actually set correctly
            if (tokenContract.allowance(msg.sender, address(this)) < amount) {
                revert SecurityViolation("permit");
            }
            // Permit succeeded and allowance verified, proceed with funding
            _performFund(amount);
        } catch {
            // Permit failed - revert with custom error
            revert SecurityViolation("permit");
        }
    }

    // ----------- Claim Functions ----------- //
    /**
     * @notice Pay rewards with EIP-712 signature (cumulative pattern)
     * @param account Account to pay (≠ msg.sender with Router)
     * @param cumulativeAmount Total cumulative amount due
     * @param signature Publisher's EIP-712 signature
     * @return gross Total amount claimed this transaction
     * @return fee Platform fee deducted
     * @return net Net amount transferred to account
     */
    function payWithSig(
        address account,
        uint256 cumulativeAmount,
        bytes calldata signature
    ) external nonReentrant whenNotPaused returns (uint256 gross, uint256 fee, uint256 net) {
        if (cumulativeAmount <= alreadyClaimed[account]) revert AlreadyExists("claim");

        // EIP-712 signature verification (uses OZ EIP712 inheritance)
        bytes32 typeHash = keccak256("Claim(address account,uint256 cumulativeAmount)");
        bytes32 structHash = keccak256(abi.encode(typeHash, account, cumulativeAmount));
        bytes32 digest = _hashTypedDataV4(structHash); // OZ EIP712 handles domain + chainId
        address signer = ECDSA.recover(digest, signature);

        // Centralized publisher validation via factory authority
        // SCALABLE: One factory update affects ALL vaults (no per-vault rotation)
        {
            (address currentPublisher, address oldPublisher, uint256 graceEndTime) = IRewardPoolFactory(
                poolConfig.factory
            ).getPublisherInfo();
            bool validSigner = (signer == currentPublisher) ||
                (graceEndTime > 0 && block.timestamp < graceEndTime && signer == oldPublisher);
            if (!validSigner) revert SecurityViolation("signature");
        }

        // Calculate amount to pay with cumulative fee precision
        gross = cumulativeAmount - alreadyClaimed[account]; // newAmount

        {
            uint256 cumulativeFeeDue = (cumulativeAmount * FEE_MULTIPLIER) / FEE_DENOMINATOR;
            fee = cumulativeFeeDue - alreadyFeePaid[account]; // feeForThisClaim
            net = gross - fee;

            if (IERC20(poolConfig.token).balanceOf(address(this)) < gross) revert InvalidParameter("balance");

            // Effects before interactions
            alreadyClaimed[account] = cumulativeAmount;
            alreadyFeePaid[account] = cumulativeFeeDue; // Track cumulative fees paid
        }

        globalAlreadyClaimed += gross;
        poolConfig.lastClaimTimestamp = uint64(block.timestamp);

        // Interactions: transfer to account FIRST, then treasury for atomicity
        // If account transfer fails, treasury doesn't get fee (prevents inconsistent state)
        IERC20(poolConfig.token).safeTransfer(account, net);
        if (fee > 0) IERC20(poolConfig.token).safeTransfer(poolConfig.platformTreasury, fee);

        // Single event for The Graph efficiency
        emit ClaimedMinimal(account, poolConfig.token, cumulativeAmount);
    }

    // ----------- Governance Functions ----------- //
    /**
     * @notice Update platform treasury
     * @param newTreasury New treasury address
     */
    function updatePlatformTreasury(address newTreasury) external onlyFactoryTimelock {
        if (newTreasury == address(0)) revert InvalidParameter("treasury");
        address oldTreasury = poolConfig.platformTreasury;
        poolConfig.platformTreasury = newTreasury;
        emit PlatformTreasuryUpdated(oldTreasury, newTreasury);
    }

    // ----------- Emergency Functions ----------- //
    /**
     * @notice Initiate emergency sweep notice (custodial governance escape hatch)
     * @param to Address to sweep funds to
     * @param justification Public justification for sweep
     */
    function initiateEmergencySweepNotice(address to, string calldata justification) external onlyFactoryTimelock {
        if (!paused()) revert SecurityViolation("pause_required");
        if (to == address(0)) revert InvalidParameter("recipient");
        if (block.timestamp < poolConfig.lastClaimTimestamp + EMERGENCY_SWEEP_GRACE_PERIOD)
            revert SecurityViolation("grace_period");

        emergencyNoticeTimestamp = block.timestamp;

        // MANDATORY: Emit public notice with technical justification
        emit EmergencySweepNoticeInitiated(to, justification, emergencyNoticeTimestamp + EMERGENCY_NOTICE_PERIOD);
    }

    /**
     * @notice Execute emergency sweep after notice period
     * @param to Address to sweep funds to
     */
    function emergencySweepAll(address to) external onlyFactoryTimelock {
        if (emergencyNoticeTimestamp == 0) revert InvalidParameter("notice_required");
        if (block.timestamp < emergencyNoticeTimestamp + EMERGENCY_NOTICE_PERIOD)
            revert InvalidParameter("notice_period");

        // CRITICAL: This bypasses ALL safety checks including untracked allocations
        uint256 balance = IERC20(poolConfig.token).balanceOf(address(this));
        if (balance == 0) revert InvalidParameter("balance");

        IERC20(poolConfig.token).safeTransfer(to, balance);

        // Reset notice to prevent reuse
        emergencyNoticeTimestamp = 0;

        emit EmergencySweep(to, balance);
    }

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

    // ----------- View Functions ----------- //
    /**
     * @notice Get factory address for ClaimRouter validation (anti-phishing)
     * @return factory Factory contract address
     */
    function getFactory() external view returns (address) {
        return poolConfig.factory;
    }

    /**
     * @notice Get token address
     * @return Token contract address
     */
    function token() external view returns (address) {
        return poolConfig.token;
    }

    /**
     * @notice Get platform treasury address
     * @return Platform treasury address
     */
    function platformTreasury() external view returns (address) {
        return poolConfig.platformTreasury;
    }

    /**
     * @notice Get last claim timestamp
     * @return Last claim timestamp
     */
    function lastClaimTimestamp() external view returns (uint256) {
        return poolConfig.lastClaimTimestamp;
    }

    /**
     * @notice Get factory address
     * @return Factory contract address
     */
    function factory() external view returns (address) {
        return poolConfig.factory;
    }

    // ----------- ERC-165 Support ----------- //
    /**
     * @notice Check interface support
     * @param interfaceId Interface ID to check
     * @return bool Whether interface is supported
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC165Upgradeable) returns (bool) {
        return interfaceId == type(IVaultClaim).interfaceId || super.supportsInterface(interfaceId);
    }

    // ----------- Events ----------- //
    /// @notice Emitted when the vault is funded with tokens
    /// @param funder Address that funded the vault
    /// @param token Token address that was funded
    /// @param amount Amount of tokens funded
    event Funded(address indexed funder, address indexed token, uint256 indexed amount);

    // Optimized event for massive claims volume (2 indexed params)
    /// @notice Emitted when a claim is processed (minimal event for gas efficiency)
    /// @param account Address that claimed tokens
    /// @param token Token address that was claimed
    /// @param cumulativeAmount Total cumulative amount claimed by this account
    event ClaimedMinimal(address indexed account, address indexed token, uint256 indexed cumulativeAmount);

    /// @notice Emitted when platform treasury address is updated
    /// @param oldTreasury Previous treasury address
    /// @param newTreasury New treasury address
    event PlatformTreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    /// @notice Emitted when emergency sweep notice is initiated
    /// @param to Address that will receive the swept funds
    /// @param justification Public justification for the sweep
    /// @param executionTimestamp Timestamp when sweep can be executed
    event EmergencySweepNoticeInitiated(address indexed to, string justification, uint256 indexed executionTimestamp);
    /// @notice Emitted when emergency sweep is executed
    /// @param to Address that received the swept funds
    /// @param amount Amount of tokens swept
    event EmergencySweep(address indexed to, uint256 indexed amount);
}

/**
 * @title IRewardPoolFactory
 * @notice Interface for factory governance functions
 * @author CLONES
 */
interface IRewardPoolFactory {
    /// @notice Get current publisher information including grace period
    /// @return current Current active publisher address
    /// @return old Previous publisher address during grace period
    /// @return graceEnd Timestamp when grace period ends
    function getPublisherInfo() external view returns (address current, address old, uint256 graceEnd);
    /// @notice Get guardian information
    /// @return Guardian address
    function getGuardianInfo() external view returns (address);
    /// @notice Get timelock address
    /// @return Timelock address
    function timelock() external view returns (address);
    /// @notice Get guardian address
    /// @return Guardian address
    function guardian() external view returns (address);
}
