// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
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
    
    // Referral-specific errors
    error ReferralLengthMismatch(uint256 referralsLength, uint256 amountsLength);
    error TooManyReferrals(uint256 provided, uint256 maximum);
    error ZeroAddressReferrer(uint256 index);
    error ReferralAmountExceedsFee(uint256 totalReferrals, uint256 availableFee);
    error InsufficientFeeForReferrals(uint256 required, uint256 available);

    // ----------- Constants ----------- //
    /// @notice Platform fee in basis points (10%)
    uint16 public constant FEE_BPS = 1000; // 10% fixed globally
    /// @notice Grace period for publisher rotation
    uint256 public constant PUBLISHER_GRACE_PERIOD = 7 days;
    /// @notice Grace period before emergency sweep can be executed
    uint256 public constant EMERGENCY_SWEEP_GRACE_PERIOD = 180 days;
    /// @notice Maximum gas allowed per emergency sweep operation
    uint256 public constant EMERGENCY_SWEEP_GAS_LIMIT = 500_000; // 500k gas limit
    /// @notice Maximum claims per block to prevent spam attacks
    uint256 public constant MAX_CLAIMS_PER_BLOCK = 50; // Circuit breaker
    /// @notice Threshold for high-value claim monitoring (in token decimals)
    uint256 public constant HIGH_VALUE_CLAIM_THRESHOLD = 1000e18; // 1000 tokens

    uint256 private constant FEE_DENOMINATOR = 10000;
    /// @notice Minimum claim amount to prevent precision attacks (dynamically calculated)
    uint256 private constant MIN_CLAIM_AMOUNT_BASE = 1e16; // 0.01 tokens for 18 decimals

    /// @notice EIP-712 type hash for Claim struct with nonce for replay protection
    bytes32 private constant CLAIM_TYPEHASH =
        keccak256("Claim(address account,uint256 cumulativeAmount,uint256 nonce)");

    // ----------- State Variables ----------- //
    struct PoolConfig {
        address token; // 20 bytes
        address platformTreasury; // 20 bytes
        address factory; // 20 bytes - overflow to slot 1
        uint256 lastClaimTimestamp; // Full uint256 to prevent 2106 overflow
    }
    /// @notice Pool configuration struct containing token, treasury, factory addresses and timestamp
    PoolConfig public poolConfig;

    /// @notice Address of the pool creator (who can withdraw funds)
    address public creator;
    /// @notice Timestamp when pool was created (for tracking)
    uint256 public poolCreationTime;

    // Cumulative claim tracking
    /// @notice Tracks cumulative amount already claimed per account
    mapping(address => uint256) public alreadyClaimed; // Cumulative amount already claimed
    /// @notice Tracks cumulative fees already paid per account
    mapping(address => uint256) public alreadyFeePaid; // Cumulative fees already paid by account
    /// @notice Total amount already claimed by all users
    uint256 public globalAlreadyClaimed; // Total amount already claimed by all users
    /// @notice Per-account nonce for replay protection
    mapping(address => uint256) public claimNonce; // account -> nonce

    // Emergency sweep state
    /// @notice Timestamp when emergency sweep notice was initiated
    uint256 public emergencyNoticeTimestamp; // On-chain notice timestamp
    /// @notice Mandatory notice period before emergency sweep can be executed
    uint256 public constant EMERGENCY_NOTICE_PERIOD = 7 days; // Mandatory notice period

    // Rate limiting state
    /// @notice Claims count per block for rate limiting
    mapping(uint256 => uint256) public claimsPerBlock; // block number -> claim count

    // ----------- Modifiers ----------- //
    modifier onlyFactoryTimelock() {
        if (msg.sender != IRewardPoolFactory(poolConfig.factory).TIMELOCK()) revert Unauthorized("timelock");
        _;
    }

    modifier onlyFactoryGuardian() {
        if (msg.sender != IRewardPoolFactory(poolConfig.factory).GUARDIAN()) revert Unauthorized("guardian");
        _;
    }

    modifier rateLimited() {
        uint256 currentCount = claimsPerBlock[block.number];
        if (currentCount >= MAX_CLAIMS_PER_BLOCK) {
            emit RateLimitHit(block.number, currentCount, MAX_CLAIMS_PER_BLOCK);
            revert SecurityViolation("rate_limit_exceeded");
        }
        claimsPerBlock[block.number] = currentCount + 1;

        // Alert when approaching limit (80% threshold)
        if (currentCount + 1 >= (MAX_CLAIMS_PER_BLOCK * 80) / 100) {
            emit SuspiciousActivity(
                msg.sender,
                "high_claim_frequency",
                "Approaching rate limit for this block",
                block.timestamp
            );
        }
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
     * @param creator_ Address of the pool creator
     */
    function initialize(
        address token_,
        address platformTreasury_,
        address factory_,
        address creator_
    ) external initializer {
        if (token_ == address(0)) revert InvalidParameter("token");
        if (platformTreasury_ == address(0)) revert InvalidParameter("treasury");
        if (factory_ == address(0)) revert InvalidParameter("factory");
        if (creator_ == address(0)) revert InvalidParameter("creator");

        // Initialize inherited contracts (NO AccessControl)
        __Pausable_init();
        __ReentrancyGuard_init();
        __EIP712_init("FactoryVault", "1");

        // Set contract state
        poolConfig = PoolConfig({
            token: token_,
            platformTreasury: platformTreasury_,
            factory: factory_,
            lastClaimTimestamp: block.timestamp
        });

        creator = creator_;
        poolCreationTime = block.timestamp;
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

    /**
     * @notice Withdraw funds from the pool (creator only)
     * @dev Creator can withdraw freely. Backend enforces checks to prevent withdrawing allocated rewards.
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 amount) external nonReentrant whenNotPaused {
        if (msg.sender != creator) revert Unauthorized("creator");
        if (amount == 0) revert InvalidParameter("amount");

        IERC20 tokenContract = IERC20(poolConfig.token);
        uint256 balance = tokenContract.balanceOf(address(this));
        if (balance < amount) revert InvalidParameter("balance");

        tokenContract.safeTransfer(creator, amount);

        emit Withdrawn(creator, poolConfig.token, amount);
    }

    // ----------- Claim Functions ----------- //
    /**
     * @notice Pay rewards with EIP-712 signature (cumulative pattern with nonce for replay protection)
     * @param account Account to pay (≠ msg.sender with Router)
     * @param cumulativeAmount Total cumulative amount due
     * @param nonce Expected nonce for replay protection
     * @param signature Publisher's EIP-712 signature
     * @return gross Total amount claimed this transaction
     * @return fee Platform fee deducted
     * @return net Net amount transferred to account
     */
    function payWithSig(
        address account,
        uint256 cumulativeAmount,
        uint256 nonce,
        bytes calldata signature
    ) external nonReentrant whenNotPaused rateLimited returns (uint256 gross, uint256 fee, uint256 net) {
        return _payWithSigInternal(account, cumulativeAmount, nonce, signature, new address[](0), new uint256[](0));
    }

    function payWithSigAndReferrals(
        address account,
        uint256 cumulativeAmount,
        uint256 nonce,
        bytes calldata signature,
        address[] calldata referrals,
        uint256[] calldata referralAmounts
    ) external nonReentrant whenNotPaused rateLimited returns (uint256 gross, uint256 fee, uint256 net) {
        if (referrals.length != referralAmounts.length) revert ReferralLengthMismatch(referrals.length, referralAmounts.length);
        if (referrals.length > 2) revert TooManyReferrals(referrals.length, 2);
        
        // Validate referral amounts don't exceed reasonable limits
        uint256 totalReferralAmount = 0;
        for (uint256 i = 0; i < referralAmounts.length; i++) {
            if (referralAmounts[i] > 0 && referrals[i] == address(0)) revert ZeroAddressReferrer(i);
            totalReferralAmount += referralAmounts[i];
        }
        
        return _payWithSigInternal(account, cumulativeAmount, nonce, signature, referrals, referralAmounts);
    }

    function _payWithSigInternal(
        address account,
        uint256 cumulativeAmount,
        uint256 nonce,
        bytes calldata signature,
        address[] memory referrals,
        uint256[] memory referralAmounts
    ) internal returns (uint256 gross, uint256 fee, uint256 net) {
        if (cumulativeAmount <= alreadyClaimed[account]) revert AlreadyExists("claim");

        // Nonce validation for replay protection
        if (nonce != claimNonce[account]) revert SecurityViolation("invalid_nonce");

        // EIP-712 signature verification with nonce
        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, account, cumulativeAmount, nonce));
        bytes32 digest = _hashTypedDataV4(structHash); // OZ EIP712 handles domain + chainId
        address signer = ECDSA.recover(digest, signature);

        // Centralized publisher validation via factory authority with emergency revocation
        // SCALABLE: One factory update affects ALL vaults (no per-vault rotation)
        if (!IRewardPoolFactory(poolConfig.factory).isValidPublisher(signer)) {
            revert SecurityViolation("signature");
        }

        // Calculate amount to pay with cumulative fee precision
        gross = cumulativeAmount - alreadyClaimed[account]; // newAmount

        // Precision attack prevention: enforce minimum gross claim amount (dynamic based on token)
        uint256 minClaimAmount = _getMinClaimAmount();
        if (gross < minClaimAmount) {
            emit SuspiciousActivity(
                account,
                "precision_attack",
                "Claim amount too small - potential precision attack",
                block.timestamp
            );
            revert SecurityViolation("claim_too_small");
        }

        {
            // Safe fee calculation to prevent overflow
            uint256 cumulativeFeeDue = Math.mulDiv(cumulativeAmount, FEE_BPS, FEE_DENOMINATOR);
            fee = cumulativeFeeDue - alreadyFeePaid[account]; // feeForThisClaim
            net = gross - fee;
            
            // CRITICAL: Validate referral amounts don't exceed platform fee
            uint256 totalReferralFee = 0;
            for (uint256 i = 0; i < referralAmounts.length; i++) {
                totalReferralFee += referralAmounts[i];
            }
            if (totalReferralFee > fee) revert ReferralAmountExceedsFee(totalReferralFee, fee);

            // Additional precision check: ensure fee calculation is meaningful
            if (gross >= minClaimAmount && fee == 0 && FEE_BPS > 0) {
                emit SuspiciousActivity(
                    account,
                    "fee_bypass",
                    "Zero fee on significant claim - potential precision exploit",
                    block.timestamp
                );
            }

            if (IERC20(poolConfig.token).balanceOf(address(this)) < gross) revert InvalidParameter("balance");

            // Effects before interactions
            // Save previous total for monitoring checks before state update
            uint256 previousClaimed = alreadyClaimed[account];
            alreadyClaimed[account] = cumulativeAmount;
            alreadyFeePaid[account] = cumulativeFeeDue; // Track cumulative fees paid

            // Check for suspicious patterns - multiple large claims from same account
            if (
                previousClaimed > 0 &&
                previousClaimed >= HIGH_VALUE_CLAIM_THRESHOLD &&
                gross >= HIGH_VALUE_CLAIM_THRESHOLD
            ) {
                emit SuspiciousActivity(
                    account,
                    "repeated_high_value",
                    "Multiple high-value claims from same account",
                    block.timestamp
                );
            }
        }

        globalAlreadyClaimed += gross;
        poolConfig.lastClaimTimestamp = block.timestamp;
        ++claimNonce[account]; // Increment nonce to prevent replay

        // Interactions: Handle multi-recipient transfers
        // 1. Transfer to referrers first (if any)
        // 2. Transfer remaining fee to platform treasury  
        // 3. Transfer net amount to farmer
        
        uint256 totalReferralSent = 0;
        for (uint256 i = 0; i < referrals.length; i++) {
            if (referralAmounts[i] > 0) {
                IERC20(poolConfig.token).safeTransfer(referrals[i], referralAmounts[i]);
                totalReferralSent += referralAmounts[i];
                emit ReferralReward(referrals[i], referralAmounts[i], account);
            }
        }
        
        // Transfer remaining fee to platform treasury (fee - total referral rewards)
        uint256 remainingFee = fee - totalReferralSent;
        if (remainingFee > 0) {
            IERC20(poolConfig.token).safeTransfer(poolConfig.platformTreasury, remainingFee);
        }
        
        // Transfer net amount to farmer
        IERC20(poolConfig.token).safeTransfer(account, net);

        // Security monitoring and alerting
        if (gross >= HIGH_VALUE_CLAIM_THRESHOLD) {
            emit HighValueClaim(account, gross, cumulativeAmount, block.timestamp);
        }

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
     * @notice Execute emergency sweep after notice period with gas limit protection
     * @param to Address to sweep funds to
     */
    function emergencySweepAll(address to) external onlyFactoryTimelock {
        if (emergencyNoticeTimestamp == 0) revert InvalidParameter("notice_required");
        if (block.timestamp < emergencyNoticeTimestamp + EMERGENCY_NOTICE_PERIOD)
            revert InvalidParameter("notice_period");

        // CRITICAL: This bypasses ALL safety checks including untracked allocations
        uint256 balance = IERC20(poolConfig.token).balanceOf(address(this));
        if (balance == 0) revert InvalidParameter("balance");

        // Standard transfer with SafeERC20 protection
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

    // ----------- Internal Helper Functions ----------- //
    /**
     * @notice Get minimum claim amount dynamically based on token decimals
     * @dev Handles tokens with 6, 8, or 18 decimals (USDC, WBTC, standard ERC20)
     * @return Minimum claim amount (0.01 tokens equivalent)
     */
    function _getMinClaimAmount() internal view returns (uint256) {
        try IERC20Metadata(poolConfig.token).decimals() returns (uint8 decimals) {
            // 0.01 tokens = 1e16 for 18 decimals, 1e4 for 6 decimals, 1e6 for 8 decimals
            if (decimals >= 18) {
                return MIN_CLAIM_AMOUNT_BASE; // 1e16 (0.01 tokens for 18 decimals)
            } else if (decimals <= 6) {
                return 10 ** (decimals > 4 ? decimals - 2 : 1); // Minimum 10 for very low decimal tokens
            } else {
                // For 7-17 decimals: scale proportionally
                return 10 ** (decimals - 2);
            }
        } catch {
            // Fallback to 18 decimals assumption if token doesn't implement decimals()
            return MIN_CLAIM_AMOUNT_BASE;
        }
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

    // ----------- ERC-165 Support ----------- //
    /**
     * @notice Check interface support
     * @param interfaceId Interface ID to check
     * @return bool Whether interface is supported
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC165Upgradeable) returns (bool) {
        return interfaceId == type(IVaultClaim).interfaceId || super.supportsInterface(interfaceId);
    }

    // ----------- Formal Verification ----------- //
    /**
     * @notice Internal invariant checker for formal verification
     * @dev Verifies critical system invariants after state changes
     * @param account The account involved in the operation
     * @param newCumulativeAmount New cumulative amount (if applicable)
     * @return valid Whether all invariants pass
     */
    function checkInvariant(address account, uint256 newCumulativeAmount) external view returns (bool valid) {
        // INVARIANT 1: Balance Conservation - Contract must have sufficient balance
        IERC20 tokenContract = IERC20(poolConfig.token);
        uint256 currentBalance = tokenContract.balanceOf(address(this));
        if (currentBalance == 0 && globalAlreadyClaimed > 0) return false;

        // INVARIANT 2: Claim Monotonicity - Claims can only increase
        uint256 currentClaimed = alreadyClaimed[account];
        if (newCumulativeAmount < currentClaimed) return false;

        // INVARIANT 3: Fee Calculation Consistency
        if (newCumulativeAmount > currentClaimed) {
            uint256 grossAmount = newCumulativeAmount - currentClaimed;
            uint256 totalFeeDue = Math.mulDiv(newCumulativeAmount, FEE_BPS, FEE_DENOMINATOR);
            uint256 currentFeePaid = alreadyFeePaid[account];
            uint256 feeForThisClaim = totalFeeDue - currentFeePaid;

            // Fee must not exceed gross amount
            if (feeForThisClaim > grossAmount) return false;

            // Precision attack prevention (use dynamic minimum)
            uint256 minClaimAmount = _getMinClaimAmount();
            if (grossAmount > 0 && grossAmount < minClaimAmount) return false;
        }

        // INVARIANT 4: Rate Limiting Integrity
        uint256 claimsInBlock = claimsPerBlock[block.number];
        if (claimsInBlock > MAX_CLAIMS_PER_BLOCK) return false;

        // INVARIANT 5: Arithmetic Safety - mulDiv handles overflow automatically
        // OpenZeppelin Math.mulDiv() ensures safe multiplication and division
        // No explicit check needed as Math.mulDiv reverts on overflow

        return true;
    }

    // ----------- Events ----------- //
    /// @notice Emitted when the vault is funded with tokens
    /// @param funder Address that funded the vault
    /// @param token Token address that was funded
    /// @param amount Amount of tokens funded
    event Funded(address indexed funder, address indexed token, uint256 indexed amount);

    /// @notice Emitted when funds are withdrawn by creator
    /// @param creator Address that withdrew the funds
    /// @param token Token address that was withdrawn
    /// @param amount Amount of tokens withdrawn
    event Withdrawn(address indexed creator, address indexed token, uint256 indexed amount);

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

    // ----------- Security Monitoring Events ----------- //
    /// @notice Emitted for high-value claims that require monitoring
    /// @param account Address that made the high-value claim
    /// @param amount Amount of the claim (gross)
    /// @param cumulativeAmount Total cumulative amount for this account
    /// @param timestamp Block timestamp
    event HighValueClaim(address indexed account, uint256 indexed amount, uint256 cumulativeAmount, uint256 timestamp);
    /// @notice Emitted when suspicious activity is detected
    /// @param actor Address involved in suspicious activity
    /// @param activityType Type of suspicious activity
    /// @param description Human-readable description
    /// @param timestamp Block timestamp
    event SuspiciousActivity(address indexed actor, string indexed activityType, string description, uint256 timestamp);
    /// @notice Emitted when rate limits are hit
    /// @param blockNumber Block number where limit was hit
    /// @param currentCount Current count of claims in this block
    /// @param limit Maximum allowed claims per block
    event RateLimitHit(uint256 indexed blockNumber, uint256 currentCount, uint256 limit);
    /// @notice Emitted when referral rewards are paid
    /// @param referrer Address that received the referral reward
    /// @param amount Amount of referral reward
    /// @param farmer Address of the farmer who generated the reward
    event ReferralReward(address indexed referrer, uint256 indexed amount, address indexed farmer);
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
    /// @notice Check if a publisher is valid (not revoked and either current or in grace period)
    /// @param publisherToCheck Address to check
    /// @return valid Whether the publisher can sign claims
    function isValidPublisher(address publisherToCheck) external view returns (bool valid);
    /// @notice Get guardian information
    /// @return Guardian address
    function getGuardianInfo() external view returns (address);
    /// @notice Get timelock address (automatic getter)
    /// @return Timelock address
    function TIMELOCK() external view returns (address);
    /// @notice Get guardian address (automatic getter)
    /// @return Guardian address
    function GUARDIAN() external view returns (address);
}
