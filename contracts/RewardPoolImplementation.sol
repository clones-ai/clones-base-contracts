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

/**
 * @title RewardPoolImplementation
 * @notice Individual reward vault implementation using cumulative EIP-712 signature pattern
 * @dev Logic contract for EIP-1167 clones with centralized governance via factory
 * @custom:security-contact security@clones.ai
 * @author CLONES
 */
contract RewardPoolImplementation is
    Initializable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    EIP712Upgradeable,
    ERC165Upgradeable
{
    using SafeERC20 for IERC20;

    // ----------- Custom Errors ----------- //
    error InvalidParameter(string param);
    error Unauthorized(string role);
    error AlreadyExists(string resource);
    error SecurityViolation(string check);

    // ----------- Constants ----------- //
    uint16 public constant FEE_BPS = 1000; // 10% fixed globally
    uint256 public constant PUBLISHER_GRACE_PERIOD = 7 days;
    uint256 public constant EMERGENCY_SWEEP_GRACE_PERIOD = 180 days;
    uint256 public constant MAX_DEADLINE_WINDOW = 7 days; // Maximum deadline window

    // ----------- State Variables ----------- //
    address public token;
    address public platformTreasury;
    address public factory; // Reference to factory for centralized authority

    // Cumulative claim tracking
    mapping(address => uint256) public alreadyClaimed; // Cumulative amount already claimed
    mapping(address => uint256) public alreadyFeePaid; // Cumulative fees already paid by account
    uint256 public globalAlreadyClaimed; // Total amount already claimed by all users
    uint256 public lastClaimTimestamp; // Last successful claim timestamp

    // Emergency sweep state
    uint256 public emergencyNoticeTimestamp; // On-chain notice timestamp
    uint256 public constant EMERGENCY_NOTICE_PERIOD = 7 days; // Mandatory notice period

    // ----------- Modifiers ----------- //
    modifier onlyFactoryTimelock() {
        if (msg.sender != IRewardPoolFactory(factory).timelock()) revert Unauthorized("timelock");
        _;
    }

    modifier onlyFactoryGuardian() {
        if (msg.sender != IRewardPoolFactory(factory).guardian()) revert Unauthorized("guardian");
        _;
    }

    // ----------- Constructor ----------- //
    constructor() {
        // Disable initializers on implementation to prevent direct initialization
        _disableInitializers();
    }

    // ----------- Initialization ----------- //
    /**
     * @notice Initialize the vault clone
     * @param _token Token address for rewards
     * @param _creator Creator address (no special role after init)
     * @param _platformTreasury Treasury address for fees
     * @param _factory Factory address for governance
     */
    function initialize(
        address _token,
        address _creator,
        address _platformTreasury,
        address _factory
    ) external initializer {
        if (_token == address(0)) revert InvalidParameter("token");
        if (_platformTreasury == address(0)) revert InvalidParameter("treasury");
        if (_factory == address(0)) revert InvalidParameter("factory");

        // Initialize inherited contracts (NO AccessControl)
        __Pausable_init();
        __ReentrancyGuard_init();
        __EIP712_init("FactoryVault", "1");

        // Set contract state
        token = _token;
        platformTreasury = _platformTreasury;
        factory = _factory;
        lastClaimTimestamp = block.timestamp;

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
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));

        uint256 actualReceived = balanceAfter - balanceBefore;
        if (actualReceived != amount) revert SecurityViolation("token_transfer");

        emit Funded(msg.sender, token, amount);
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
        try IERC20Permit(token).permit(msg.sender, address(this), amount, deadline, v, r, s) {
            // POST-CHECK: Verify allowance was actually set correctly
            if (IERC20(token).allowance(msg.sender, address(this)) < amount) {
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
     * @param deadline Signature deadline
     * @param signature Publisher's EIP-712 signature
     * @return gross Total amount claimed this transaction
     * @return fee Platform fee deducted
     * @return net Net amount transferred to account
     */
    function payWithSig(
        address account,
        uint256 cumulativeAmount,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant whenNotPaused returns (uint256 gross, uint256 fee, uint256 net) {
        // Deadline validation: must not be expired and must not be too far in future
        if (deadline < block.timestamp) revert SecurityViolation("deadline");
        if (deadline > block.timestamp + MAX_DEADLINE_WINDOW) revert InvalidParameter("deadline");
        if (cumulativeAmount <= alreadyClaimed[account]) revert AlreadyExists("claim");

        // EIP-712 signature verification (uses OZ EIP712 inheritance)
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Claim(address account,uint256 cumulativeAmount,uint256 deadline)"),
                account,
                cumulativeAmount,
                deadline
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash); // OZ EIP712 handles domain + chainId
        address signer = ECDSA.recover(digest, signature);

        // Centralized publisher validation via factory authority
        // SCALABLE: One factory update affects ALL vaults (no per-vault rotation)
        {
            (address currentPublisher, address oldPublisher, uint256 graceEndTime) = IRewardPoolFactory(factory)
                .getPublisherInfo();
            bool validSigner = (signer == currentPublisher) ||
                (graceEndTime > 0 && block.timestamp < graceEndTime && signer == oldPublisher);
            if (!validSigner) revert SecurityViolation("signature");
        }

        // Calculate amount to pay with cumulative fee precision
        gross = cumulativeAmount - alreadyClaimed[account]; // newAmount

        // Fee calculation: cumulative precision to prevent rounding leaks
        {
            uint256 cumulativeFeeDue = (cumulativeAmount * FEE_BPS) / 10000;
            fee = cumulativeFeeDue - alreadyFeePaid[account]; // feeForThisClaim
            net = gross - fee;

            if (IERC20(token).balanceOf(address(this)) < gross) revert InvalidParameter("balance");

            // Effects before interactions
            alreadyClaimed[account] = cumulativeAmount;
            alreadyFeePaid[account] = cumulativeFeeDue; // Track cumulative fees paid
        }

        globalAlreadyClaimed += gross;
        lastClaimTimestamp = block.timestamp;

        // Interactions: transfer to account FIRST, then treasury for atomicity
        // If account transfer fails, treasury doesn't get fee (prevents inconsistent state)
        IERC20(token).safeTransfer(account, net);
        if (fee > 0) IERC20(token).safeTransfer(platformTreasury, fee);

        // Single event for The Graph efficiency
        emit ClaimedMinimal(account, token, cumulativeAmount);
    }

    // ----------- Governance Functions ----------- //
    /**
     * @notice Update platform treasury
     * @param newTreasury New treasury address
     */
    function updatePlatformTreasury(address newTreasury) external onlyFactoryTimelock {
        if (newTreasury == address(0)) revert InvalidParameter("treasury");
        address oldTreasury = platformTreasury;
        platformTreasury = newTreasury;
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
        if (block.timestamp < lastClaimTimestamp + EMERGENCY_SWEEP_GRACE_PERIOD)
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
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) revert InvalidParameter("balance");

        IERC20(token).safeTransfer(to, balance);

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
        return factory;
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
    event Funded(address indexed funder, address indexed token, uint256 amount);

    // Optimized event for massive claims volume (2 indexed params)
    event ClaimedMinimal(address indexed account, address indexed token, uint256 cumulativeAmount);

    event PlatformTreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event EmergencySweepNoticeInitiated(address indexed to, string justification, uint256 executionTimestamp);
    event EmergencySweep(address indexed to, uint256 amount);
}

/**
 * @title IRewardPoolFactory
 * @notice Interface for factory governance functions
 */
interface IRewardPoolFactory {
    function getPublisherInfo() external view returns (address current, address old, uint256 graceEnd);
    function getGuardianInfo() external view returns (address);
    function timelock() external view returns (address);
    function guardian() external view returns (address);
}

/**
 * @title IVaultClaim
 * @notice Internal Clones ecosystem interface for vault interactions
 * @dev Version: 1.0.0 - Clones Ecosystem Internal Standard ONLY
 */
interface IVaultClaim {
    function payWithSig(
        address account,
        uint256 cumulativeAmount,
        uint256 deadline,
        bytes calldata signature
    ) external returns (uint256 gross, uint256 fee, uint256 net);
    function getFactory() external view returns (address factory);
}
