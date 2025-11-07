// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title DatasetTokenImplementation
 * @notice EIP-1167 implementation contract for dataset tokens with burn-to-download functionality
 * @dev Fixed supply of 1 billion tokens (6 decimals) with burn threshold for download access
 * @author CLONES
 */
contract DatasetTokenImplementation is ERC20, ERC20Burnable, ReentrancyGuard {
    // ----------- Custom Errors ----------- //
    error InvalidParameter(string param);
    error Unauthorized(string role);
    error SecurityViolation(string check);
    error AlreadyInitialized();

    // ----------- Constants ----------- //
    /// @notice Token decimals (6 for gas efficiency on Base L2)
    uint8 private constant DECIMALS = 6;
    /// @notice Total supply: 1,000,000,000 (1 billion) tokens
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 10 ** DECIMALS;
    /// @notice Tokens allocated to bonding curve (793.1M)
    uint256 public constant CURVE_SUPPLY = 793_100_000 * 10 ** DECIMALS;
    /// @notice Tokens reserved for LP at graduation (206.9M)
    uint256 public constant LP_SUPPLY = 206_900_000 * 10 ** DECIMALS;

    // ----------- State Variables ----------- //
    /// @notice Dataset creator address
    address public creator;
    /// @notice Factory contract address
    address public factory;
    /// @notice Bonding curve contract address
    address public bondingCurve;
    /// @notice Burn portal contract address for downloads
    address public burnPortal;
    /// @notice Graduation manager contract address
    address public graduationManager;
    /// @notice Percentage of supply required to burn for download (1-10%)
    uint8 public burnThresholdPercentage;
    /// @notice Absolute burn threshold in tokens
    uint256 public burnThreshold;
    /// @notice Whether the token has graduated to Uniswap
    bool public isGraduated;
    /// @notice Whether this implementation has been initialized
    bool private _initialized;
    /// @notice Token name for proxy instances
    string private _proxyName;
    /// @notice Token symbol for proxy instances
    string private _proxySymbol;

    // ----------- Events ----------- //
    /// @notice Emitted when tokens are burned for dataset download
    event BurnForDownload(address indexed burner, uint256 amount, uint256 timestamp);
    /// @notice Emitted when bonding curve address is set
    event BondingCurveSet(address indexed bondingCurve);
    /// @notice Emitted when burn portal address is set
    event BurnPortalSet(address indexed burnPortal);
    /// @notice Emitted when token graduates to Uniswap
    event Graduated(uint256 timestamp, address indexed graduationManager);

    // ----------- Modifiers ----------- //
    modifier onlyFactory() {
        if (msg.sender != factory) revert Unauthorized("factory");
        _;
    }

    modifier onlyBondingCurve() {
        if (msg.sender != bondingCurve) revert Unauthorized("bonding_curve");
        _;
    }

    modifier onlyBurnPortal() {
        if (msg.sender != burnPortal) revert Unauthorized("burn_portal");
        _;
    }

    modifier onlyGraduationManager() {
        if (msg.sender != graduationManager) revert Unauthorized("graduation_manager");
        _;
    }

    modifier onlyCreatorOrFactory() {
        if (msg.sender != creator && msg.sender != factory) revert Unauthorized("creator_or_factory");
        _;
    }

    // ----------- Constructor ----------- //
    /// @notice Constructor disables initializers on implementation
    /// @dev Implementation contract should not be initialized directly
    constructor() ERC20("DatasetToken Implementation", "DATASET-IMPL") {
        _initialized = true; // Prevent implementation initialization
    }

    // ----------- Initialization ----------- //
    /**
     * @notice Initialize the dataset token (called by factory)
     * @dev Can only be called once per clone
     * @param _name Dataset token name
     * @param _symbol Dataset token symbol
     * @param _creator Dataset creator address
     * @param _factory Factory contract address
     * @param _burnThresholdPercentage Percentage of supply required to burn (1-10%)
     */
    function initialize(
        string memory _name,
        string memory _symbol,
        address _creator,
        address _factory,
        uint8 _burnThresholdPercentage
    ) external {
        if (_initialized) revert AlreadyInitialized();
        if (_creator == address(0)) revert InvalidParameter("creator");
        if (_factory == address(0)) revert InvalidParameter("factory");
        if (_burnThresholdPercentage < 1 || _burnThresholdPercentage > 10) {
            revert InvalidParameter("burn_threshold");
        }

        // Store name and symbol for proxy instances
        _proxyName = _name;
        _proxySymbol = _symbol;

        creator = _creator;
        factory = _factory;
        burnThresholdPercentage = _burnThresholdPercentage;
        burnThreshold = Math.mulDiv(TOTAL_SUPPLY, _burnThresholdPercentage, 100);
        _initialized = true;

        // Mint entire supply to this contract
        _mint(address(this), TOTAL_SUPPLY);
    }

    // ----------- Bonding Curve Integration ----------- //
    /**
     * @notice Set bonding curve address (can only be set once by factory)
     * @param _bondingCurve Bonding curve contract address
     */
    function setBondingCurve(address _bondingCurve) external onlyFactory {
        if (bondingCurve != address(0)) revert SecurityViolation("already_set");
        if (_bondingCurve == address(0)) revert InvalidParameter("bonding_curve");

        bondingCurve = _bondingCurve;

        // Transfer curve supply to bonding curve for trading
        _transfer(address(this), _bondingCurve, CURVE_SUPPLY);

        emit BondingCurveSet(_bondingCurve);
    }

    /**
     * @notice Set graduation manager address (factory only)
     * @param _graduationManager Graduation manager contract address
     */
    function setGraduationManager(address _graduationManager) external onlyFactory {
        if (_graduationManager == address(0)) revert InvalidParameter("graduation_manager");
        graduationManager = _graduationManager;
    }

    /**
     * @notice Set burn portal address (factory only)
     * @param _burnPortal Burn portal contract address
     */
    function setBurnPortal(address _burnPortal) external onlyCreatorOrFactory {
        if (burnPortal != address(0)) revert SecurityViolation("already_set");
        if (_burnPortal == address(0)) revert InvalidParameter("burn_portal");
        burnPortal = _burnPortal;
        emit BurnPortalSet(_burnPortal);
    }

    // ----------- Graduation Logic ----------- //
    /**
     * @notice Mark token as graduated and transfer LP tokens (graduation manager only)
     * @dev Called when bonding curve reaches $69k market cap
     */
    function graduate() external onlyGraduationManager nonReentrant {
        if (isGraduated) revert SecurityViolation("already_graduated");

        isGraduated = true;

        // Transfer LP supply to graduation manager for Uniswap V2 liquidity
        uint256 lpSupply = balanceOf(address(this));
        if (lpSupply > 0) {
            _transfer(address(this), graduationManager, lpSupply);
        }

        emit Graduated(block.timestamp, graduationManager);
    }

    // ----------- Burn Portal Integration ----------- //
    /**
     * @notice Burn tokens for dataset download (only through burn portal after graduation)
     * @param from Address to burn from
     * @param amount Amount to burn
     */
    function burnForDownload(address from, uint256 amount) external onlyBurnPortal nonReentrant {
        if (!isGraduated) revert SecurityViolation("not_graduated");
        if (amount < burnThreshold) revert SecurityViolation("insufficient_burn");

        _burn(from, amount);

        emit BurnForDownload(from, amount, block.timestamp);
    }

    // ----------- View Functions ----------- //
    /**
     * @notice Get token decimals
     * @return Number of decimals
     */
    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    /**
     * @notice Get token name
     * @return Token name for this proxy instance
     */
    function name() public view override returns (string memory) {
        return _initialized ? _proxyName : super.name();
    }

    /**
     * @notice Get token symbol
     * @return Token symbol for this proxy instance
     */
    function symbol() public view override returns (string memory) {
        return _initialized ? _proxySymbol : super.symbol();
    }

    /**
     * @notice Calculate current supply reduction from burns
     * @return Percentage of supply burned (basis points)
     */
    function getSupplyReduction() external view returns (uint256) {
        uint256 currentSupply = totalSupply();
        uint256 burned = TOTAL_SUPPLY - currentSupply;
        return Math.mulDiv(burned, 10000, TOTAL_SUPPLY); // In basis points
    }

    /**
     * @notice Get dataset creation info
     * @return creator_ Dataset creator address
     * @return burnThreshold_ Burn threshold for downloads
     * @return isGraduated_ Whether token has graduated
     */
    function getDatasetInfo() external view returns (address creator_, uint256 burnThreshold_, bool isGraduated_) {
        return (creator, burnThreshold, isGraduated);
    }

    /**
     * @notice Check if this contract is initialized
     * @return Whether the contract has been initialized
     */
    function initialized() external view returns (bool) {
        return _initialized;
    }
}
