// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title RewardPool (UUPS Upgradeable)
 * @notice Centralized reward pool for multiple factories. Farmers withdraw their rewards and pay gas.
 *         A platform fee is skimmed on each withdrawal and sent to the treasury. Supports multiple ERC20 tokens
 *         and native ETH on Base.
 * @dev    Designed for Base L2. Uses OZ v5.x upgradeable contracts.
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
    event RewardsWithdrawn(
        address indexed farmer,
        address indexed token, // address(0) => native ETH
        uint256 grossAmount,
        uint256 feeAmount,
        uint256 netAmount,
        uint256 factoryCount,
        uint256 timestamp
    );

    // ----------- Constants ----------- //
    uint16 public constant MAX_BPS = 10_000; // 100%
    uint16 public constant MAX_FEE_BPS = 2_000; // Safety cap: 20%
    address public constant NATIVE_TOKEN = address(0); // sentinel for ETH

    // ----------- Config ----------- //
    address public treasury; // where fees are sent
    uint16 public feeBps; // platform fee in basis points (e.g., 1000 = 10%)

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

    /// @notice Record rewards for a farmer. The factory must have previously funded enough tokens (ERC20 or ETH).
    /// @dev    Transparent and auditable: increases farmer accruals and decreases factory funding.
    function recordReward(
        address farmer,
        address token,
        uint256 amount
    ) external whenNotPaused onlyRole(FACTORY_ROLE) {
        if (farmer == address(0)) revert ZeroAddress();
        if (amount == 0) return; // no-op

        uint256 available = factoryFunding[msg.sender][token];
        if (available < amount) revert InsufficientFactoryFunds();
        factoryFunding[msg.sender][token] = available - amount;

        accrued[farmer][msg.sender][token] += amount;
        totalOwedByToken[farmer][token] += amount;

        emit RewardRecorded($1, block.timestamp);
    }

    // ----------- Withdrawals (Farmer-initiated) ----------- //
    struct TokenFactoryBatch {
        address token;
        address[] factories;
    }

    /// @notice Withdraw rewards for a single token from a list of factories. Supports ERC20 and native ETH (token=address(0)).
    function withdrawTokenFromFactories(
        address token,
        address[] calldata factories
    ) public nonReentrant whenNotPaused {
        if (treasury == address(0)) revert TreasuryNotSet();

        uint256 gross;
        address farmer = msg.sender;

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

        emit RewardsWithdrawn($1, block.timestamp);
    }

    /// @notice Batch withdraw across multiple tokens, each with its own list of factories.
    function withdrawBatch(
        TokenFactoryBatch[] calldata batches
    ) external nonReentrant whenNotPaused {
        if (treasury == address(0)) revert TreasuryNotSet();
        for (uint256 i = 0; i < batches.length; i++) {
            withdrawTokenFromFactories(batches[i].token, batches[i].factories);
        }
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
    uint256[43] private __gap; // Keep total slots unchanged when adding new vars
}
