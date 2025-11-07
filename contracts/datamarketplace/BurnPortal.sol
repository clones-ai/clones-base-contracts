// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title BurnPortal
 * @notice Manages token burning for authenticated dataset download access
 * @dev Only active after dataset graduation with burn threshold enforcement
 * @author CLONES
 */
contract BurnPortal is AccessControl, Pausable, ReentrancyGuard {
    // ----------- Custom Errors ----------- //
    error InvalidParameter(string param);
    error Unauthorized(string role);
    error SecurityViolation(string check);
    error BurnFailed(string reason);

    // ----------- Constants ----------- //
    /// @notice Role identifier for timelock operations
    bytes32 public constant TIMELOCK_ROLE = keccak256("TIMELOCK_ROLE");
    /// @notice Role identifier for emergency operations
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    // ----------- Immutable State ----------- //
    /// @notice Timelock contract address
    address public immutable TIMELOCK;
    /// @notice Guardian address for emergency operations
    address public immutable GUARDIAN;

    // ----------- State Variables ----------- //
    /// @notice Dataset factory contract address
    address public datasetFactory;
    /// @notice Graduation manager contract address
    address public graduationManager;

    // ----------- Dataset Tracking ----------- //
    /// @notice Mapping of dataset token => activation status
    mapping(address => bool) public activeDatasets;
    /// @notice Mapping of dataset token => user => access status
    mapping(address => mapping(address => bool)) public hasAccess;
    /// @notice Mapping of dataset token => burn statistics
    mapping(address => BurnStats) public burnStats;

    // ----------- Structs ----------- //
    struct BurnStats {
        uint256 totalBurned; // Total tokens burned for this dataset
        uint256 burnCount; // Number of successful burns
        uint256 lastBurnTime; // Timestamp of last burn
    }

    // ----------- Events ----------- //
    /// @notice Emitted when a dataset is activated for burning
    event DatasetActivated(address indexed datasetToken, uint256 burnThreshold, uint256 timestamp);
    /// @notice Emitted when tokens are burned for dataset access
    event TokensBurnedForAccess(
        address indexed datasetToken,
        address indexed burner,
        uint256 amount,
        uint256 burnThreshold,
        uint256 timestamp
    );
    /// @notice Emitted when dataset factory is updated
    event DatasetFactoryUpdated(address indexed oldFactory, address indexed newFactory);
    /// @notice Emitted when graduation manager is updated
    event GraduationManagerUpdated(address indexed oldManager, address indexed newManager);

    // ----------- Modifiers ----------- //
    modifier onlyTimelock() {
        if (msg.sender != TIMELOCK) revert Unauthorized("timelock");
        _;
    }

    modifier onlyGuardian() {
        if (msg.sender != GUARDIAN) revert Unauthorized("guardian");
        _;
    }

    modifier onlyGraduationManager() {
        if (msg.sender != graduationManager) revert Unauthorized("graduation_manager");
        _;
    }

    modifier onlyActiveDataset(address datasetToken) {
        if (!activeDatasets[datasetToken]) revert SecurityViolation("dataset_not_active");
        _;
    }

    // ----------- Constructor ----------- //
    /// @notice Initialize the BurnPortal
    /// @param _timelock Timelock contract address
    /// @param _guardian Guardian address
    constructor(address _timelock, address _guardian) {
        if (_timelock == address(0)) revert InvalidParameter("timelock");
        if (_guardian == address(0)) revert InvalidParameter("guardian");

        TIMELOCK = _timelock;
        GUARDIAN = _guardian;

        _grantRole(DEFAULT_ADMIN_ROLE, _timelock);
        _grantRole(TIMELOCK_ROLE, _timelock);
        _grantRole(EMERGENCY_ROLE, _guardian);
    }

    // ----------- Dataset Activation ----------- //
    /**
     * @notice Activate a dataset for burning (called by graduation manager)
     * @param datasetToken Dataset token address
     */
    function activateDataset(address datasetToken) external onlyGraduationManager {
        if (datasetToken == address(0)) revert InvalidParameter("dataset_token");
        if (activeDatasets[datasetToken]) revert SecurityViolation("already_active");

        // Verify dataset has graduated
        if (!IGraduationManager(graduationManager).isGraduated(datasetToken)) {
            revert SecurityViolation("not_graduated");
        }

        activeDatasets[datasetToken] = true;

        // Get burn threshold from dataset token
        (, uint256 burnThreshold, ) = IDatasetToken(datasetToken).getDatasetInfo();

        emit DatasetActivated(datasetToken, burnThreshold, block.timestamp);
    }

    // ----------- Burn for Access ----------- //
    /**
     * @notice Burn tokens for dataset download access
     * @param datasetToken Dataset token address
     * @param amount Amount of tokens to burn (must meet threshold)
     */
    function burnForDownload(
        address datasetToken,
        uint256 amount
    ) external whenNotPaused nonReentrant onlyActiveDataset(datasetToken) {
        if (hasAccess[datasetToken][msg.sender]) {
            revert BurnFailed("already_has_access");
        }

        // Get dataset info
        (, uint256 burnThreshold, bool isGraduated) = IDatasetToken(datasetToken).getDatasetInfo();

        if (!isGraduated) revert SecurityViolation("not_graduated");
        if (amount < burnThreshold) revert BurnFailed("insufficient_amount");

        // Check user balance
        uint256 userBalance = IERC20(datasetToken).balanceOf(msg.sender);
        if (userBalance < amount) revert BurnFailed("insufficient_balance");

        // Burn tokens through dataset contract
        IDatasetToken(datasetToken).burnForDownload(msg.sender, amount);

        // Grant access
        hasAccess[datasetToken][msg.sender] = true;

        // Update statistics
        BurnStats storage stats = burnStats[datasetToken];
        stats.totalBurned += amount;
        stats.burnCount += 1;
        stats.lastBurnTime = block.timestamp;

        emit TokensBurnedForAccess(datasetToken, msg.sender, amount, burnThreshold, block.timestamp);
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
     * @notice Set graduation manager address (timelock only)
     * @param _graduationManager New graduation manager address
     */
    function setGraduationManager(address _graduationManager) external onlyTimelock {
        if (_graduationManager == address(0)) revert InvalidParameter("graduation_manager");
        address oldManager = graduationManager;
        graduationManager = _graduationManager;
        emit GraduationManagerUpdated(oldManager, _graduationManager);
    }

    // ----------- View Functions ----------- //
    /**
     * @notice Check if user has access to dataset
     * @param datasetToken Dataset token address
     * @param user User address
     * @return Whether user has burned for access
     */
    function userHasAccess(address datasetToken, address user) external view returns (bool) {
        return hasAccess[datasetToken][user];
    }

    /**
     * @notice Get burn statistics for a dataset
     * @param datasetToken Dataset token address
     * @return stats Burn statistics
     */
    function getBurnStats(address datasetToken) external view returns (BurnStats memory stats) {
        return burnStats[datasetToken];
    }

    /**
     * @notice Get number of unique burners for a dataset
     * @param datasetToken Dataset token address
     * @return Number of unique burners (from burnCount)
     */
    function getBurnerCount(address datasetToken) external view returns (uint256) {
        return burnStats[datasetToken].burnCount;
    }

    /**
     * @notice Get dataset burn threshold and current price
     * @param datasetToken Dataset token address
     * @return burnThreshold Amount required to burn
     * @return isActive Whether dataset is active for burning
     * @return isGraduated Whether dataset has graduated
     */
    function getDatasetBurnInfo(
        address datasetToken
    ) external view returns (uint256 burnThreshold, bool isActive, bool isGraduated) {
        (, burnThreshold, isGraduated) = IDatasetToken(datasetToken).getDatasetInfo();
        isActive = activeDatasets[datasetToken];
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

    /**
     * @notice Emergency deactivate dataset (guardian only)
     * @param datasetToken Dataset token to deactivate
     * @dev Only for emergency situations where dataset burning must be stopped
     */
    function emergencyDeactivateDataset(address datasetToken) external onlyGuardian {
        if (activeDatasets[datasetToken]) {
            activeDatasets[datasetToken] = false;
            emit DatasetActivated(datasetToken, 0, block.timestamp); // 0 threshold indicates deactivation
        }
    }
}

/**
 * @title IDatasetToken
 * @notice Interface for dataset token interactions
 */
interface IDatasetToken {
    function burnForDownload(address from, uint256 amount) external;
    function getDatasetInfo() external view returns (address creator, uint256 burnThreshold, bool isGraduated);
}

/**
 * @title IGraduationManager
 * @notice Interface for graduation manager interactions
 */
interface IGraduationManager {
    function isGraduated(address datasetToken) external view returns (bool);
}
