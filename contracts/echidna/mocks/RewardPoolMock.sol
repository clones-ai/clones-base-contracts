// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../../RewardPoolImplementation.sol";

/**
 * @title RewardPoolMock
 * @notice Mock version of RewardPoolImplementation for Echidna fuzzing
 * @dev Removes _disableInitializers() to allow Echidna to test the contract
 *
 * This mock bypasses the initializer protection to enable property-based testing.
 * All core logic remains identical to production RewardPoolImplementation.
 *
 * @author CLONES
 */
contract RewardPoolMock is
    Initializable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    EIP712Upgradeable,
    ERC165Upgradeable
{
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // =============================================================================
    // STATE VARIABLES (Copied from RewardPoolImplementation)
    // =============================================================================

    IERC20 public rewardToken;
    uint8 public tokenDecimals;
    address public PLATFORM_TREASURY;
    address public factory;
    address public creator;

    uint256 public constant PLATFORM_FEE_BPS = 1000; // 10%
    uint256 public constant MAX_CLAIMS_PER_BLOCK = 50;
    uint256 public constant WITHDRAWAL_TIMELOCK = 7 days;
    uint256 public constant CREATOR_WITHDRAWAL_LIMIT_BPS = 5000; // 50%
    uint256 public constant HIGH_VALUE_THRESHOLD_BPS = 1000; // 10% of pool balance

    mapping(address => uint256) public alreadyClaimed;
    mapping(address => uint256) public alreadyFeePaid;
    mapping(address => uint256) public claimNonce;
    mapping(uint256 => uint256) public claimsPerBlock;

    uint256 public globalAlreadyClaimed;
    uint256 public lastClaimBlock;
    uint256 public suspiciousClaimCount;
    uint256 public creatorWithdrawalUnlockTime;
    uint256 public totalDeposited;

    uint256 public minClaimAmount;

    // =============================================================================
    // EVENTS (Copied from RewardPoolImplementation)
    // =============================================================================

    event Funded(address indexed funder, uint256 amount, uint256 newBalance);
    event Claimed(address indexed user, uint256 amount, uint256 fee, uint256 nonce);
    event CreatorWithdrawal(address indexed creator, uint256 amount);
    event HighValueClaim(address indexed user, uint256 amount, uint256 timestamp);
    event SuspiciousActivity(bytes32 indexed activityType, address indexed user, uint256 amount, string description);

    // =============================================================================
    // ERRORS (Copied from RewardPoolImplementation)
    // =============================================================================

    error NotFactory();
    error NotCreator();
    error InvalidSignature();
    error InsufficientBalance();
    error AlreadyClaimed();
    error WithdrawalLocked();
    error ExcessiveWithdrawal();
    error InvalidNonce();
    error SecurityViolation();
    error BelowMinimumClaim();

    // =============================================================================
    // CONSTRUCTOR - MODIFIED FOR ECHIDNA
    // =============================================================================

    constructor() {
        // REMOVED: _disableInitializers() to allow Echidna testing
        // In production, this protection is critical
        // For fuzzing, we need to be able to initialize
    }

    // =============================================================================
    // INITIALIZER (Same as RewardPoolImplementation)
    // =============================================================================

    function initialize(
        address _rewardToken,
        address _platformTreasury,
        address _factory,
        address _creator
    ) external initializer {
        require(_rewardToken != address(0), "Invalid reward token");
        require(_platformTreasury != address(0), "Invalid treasury");
        require(_factory != address(0), "Invalid factory");
        require(_creator != address(0), "Invalid creator");

        __Pausable_init();
        __ReentrancyGuard_init();
        __EIP712_init("ClonesRewardPool", "1");
        __ERC165_init();

        rewardToken = IERC20(_rewardToken);
        PLATFORM_TREASURY = _platformTreasury;
        factory = _factory;
        creator = _creator;

        tokenDecimals = IERC20Metadata(_rewardToken).decimals();
        minClaimAmount = 10 ** tokenDecimals;
        creatorWithdrawalUnlockTime = block.timestamp + WITHDRAWAL_TIMELOCK;
    }

    // =============================================================================
    // CORE FUNCTIONS (All copied from RewardPoolImplementation)
    // =============================================================================

    function fund(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be positive");

        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        totalDeposited += amount;

        emit Funded(msg.sender, amount, rewardToken.balanceOf(address(this)));
    }

    function payWithSig(
        address user,
        uint256 newCumulativeAmount,
        uint256 nonce,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        // Nonce verification
        if (nonce != claimNonce[user]) revert InvalidNonce();

        // Rate limiting
        if (lastClaimBlock == block.number) {
            if (claimsPerBlock[block.number] >= MAX_CLAIMS_PER_BLOCK) {
                revert SecurityViolation();
            }
        } else {
            lastClaimBlock = block.number;
        }
        claimsPerBlock[block.number]++;

        // Signature verification
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Claim(address user,uint256 newCumulativeAmount,uint256 nonce)"),
                user,
                newCumulativeAmount,
                nonce
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = digest.recover(signature);

        if (!_isValidPublisher(signer)) revert InvalidSignature();

        // Calculate amounts
        uint256 grossClaimable = newCumulativeAmount - alreadyClaimed[user];
        if (grossClaimable < minClaimAmount) revert BelowMinimumClaim();

        uint256 fee = (grossClaimable * PLATFORM_FEE_BPS) / 10000;
        uint256 netClaimable = grossClaimable - fee;

        uint256 poolBalance = rewardToken.balanceOf(address(this));
        if (poolBalance < grossClaimable) revert InsufficientBalance();

        // Security monitoring
        _monitorClaim(user, grossClaimable, poolBalance);

        // Update state
        alreadyClaimed[user] = newCumulativeAmount;
        alreadyFeePaid[user] += fee;
        globalAlreadyClaimed += grossClaimable;
        claimNonce[user]++;

        // Transfers
        rewardToken.safeTransfer(PLATFORM_TREASURY, fee);
        rewardToken.safeTransfer(user, netClaimable);

        emit Claimed(user, netClaimable, fee, nonce);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (msg.sender != creator) revert NotCreator();
        if (block.timestamp < creatorWithdrawalUnlockTime) revert WithdrawalLocked();

        uint256 balance = rewardToken.balanceOf(address(this));
        if (amount > balance) revert InsufficientBalance();

        uint256 maxWithdrawal = (totalDeposited * CREATOR_WITHDRAWAL_LIMIT_BPS) / 10000;
        if (amount > maxWithdrawal) revert ExcessiveWithdrawal();

        rewardToken.safeTransfer(creator, amount);

        emit CreatorWithdrawal(creator, amount);
    }

    function pause() external {
        if (msg.sender != factory) revert NotFactory();
        _pause();
    }

    function unpause() external {
        if (msg.sender != factory) revert NotFactory();
        _unpause();
    }

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================

    function _isValidPublisher(address signer) internal view returns (bool) {
        // This would normally call factory.isValidPublisher(signer)
        // For fuzzing, we simplified it
        return signer != address(0);
    }

    function _monitorClaim(address user, uint256 amount, uint256 poolBalance) internal {
        // High value claim detection
        uint256 highValueThreshold = (poolBalance * HIGH_VALUE_THRESHOLD_BPS) / 10000;
        if (amount > highValueThreshold) {
            emit HighValueClaim(user, amount, block.timestamp);
        }

        // Suspicious activity detection
        if (claimsPerBlock[block.number] > (MAX_CLAIMS_PER_BLOCK * 8) / 10) {
            emit SuspiciousActivity(keccak256("HIGH_RATE"), user, amount, "Approaching rate limit");
        }

        // Repeated high value claims
        if (amount > highValueThreshold) {
            suspiciousClaimCount++;
            if (suspiciousClaimCount >= 3) {
                emit SuspiciousActivity(keccak256("REPEATED_HIGH"), user, amount, "Multiple high value claims");
            }
        }
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
