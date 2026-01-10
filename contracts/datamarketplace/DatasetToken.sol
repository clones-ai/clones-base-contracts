// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title DatasetToken
 * @notice ERC20 token representing a dataset with burn-to-download functionality
 * @dev Fixed supply of 1 billion tokens with 6 decimals
 */
contract DatasetToken is ERC20, ERC20Burnable, Ownable {
    /// @notice Token decimals (6 for efficient gas usage)
    uint8 private constant DECIMALS = 6;

    /// @notice Total supply: 1,000,000,000 (1 billion) tokens
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 10 ** DECIMALS;

    /// @notice Percentage of supply required to burn for download (1-10%)
    uint8 public immutable burnThresholdPercentage;

    /// @notice Absolute burn threshold in tokens
    uint256 public immutable burnThreshold;

    /// @notice Dataset creator address
    address public immutable creator;

    /// @notice Bonding curve contract address
    address public bondingCurve;

    /// @notice Burn portal contract address
    address public burnPortal;

    /// @notice Whether the token has graduated to Uniswap
    bool public isGraduated;

    /// @notice Emitted when tokens are burned for dataset download
    event BurnForDownload(address indexed burner, uint256 amount, uint256 timestamp);

    /// @notice Emitted when bonding curve address is set
    event BondingCurveSet(address indexed bondingCurve);

    /// @notice Emitted when burn portal address is set
    event BurnPortalSet(address indexed burnPortal);

    /// @notice Emitted when token graduates to Uniswap
    event Graduated(uint256 timestamp);

    modifier onlyBondingCurve() {
        require(msg.sender == bondingCurve, "Only bonding curve");
        _;
    }

    modifier onlyBurnPortal() {
        require(msg.sender == burnPortal, "Only burn portal");
        _;
    }

    constructor(
        string memory name,
        string memory symbol,
        address _creator,
        uint8 _burnThresholdPercentage
    ) ERC20(name, symbol) Ownable(_creator) {
        require(_creator != address(0), "Invalid creator");
        require(_burnThresholdPercentage >= 1 && _burnThresholdPercentage <= 10, "Invalid threshold");

        creator = _creator;
        burnThresholdPercentage = _burnThresholdPercentage;
        burnThreshold = (TOTAL_SUPPLY * _burnThresholdPercentage) / 100;

        // Mint entire supply to this contract
        // Bonding curve will manage distribution
        _mint(address(this), TOTAL_SUPPLY);
    }

    /**
     * @notice Set bonding curve address (can only be set once by owner)
     * @param _bondingCurve Bonding curve contract address
     */
    function setBondingCurve(address _bondingCurve) external onlyOwner {
        require(bondingCurve == address(0), "Already set");
        require(_bondingCurve != address(0), "Invalid address");

        bondingCurve = _bondingCurve;

        // Transfer 793.1M tokens to bonding curve for sale
        uint256 curveSupply = 793_100_000 * 10 ** DECIMALS;
        _transfer(address(this), bondingCurve, curveSupply);

        emit BondingCurveSet(_bondingCurve);
    }

    /**
     * @notice Set burn portal address (owner only)
     * @param _burnPortal Burn portal contract address
     */
    function setBurnPortal(address _burnPortal) external onlyOwner {
        require(_burnPortal != address(0), "Invalid address");
        burnPortal = _burnPortal;
        emit BurnPortalSet(_burnPortal);
    }

    /**
     * @notice Mark token as graduated (called by graduation manager)
     */
    function graduate() external {
        require(msg.sender == owner(), "Only owner");
        require(!isGraduated, "Already graduated");

        isGraduated = true;

        // Transfer remaining LP tokens (206.9M) to graduation manager
        uint256 lpSupply = balanceOf(address(this));
        _transfer(address(this), msg.sender, lpSupply);

        emit Graduated(block.timestamp);
    }

    /**
     * @notice Burn tokens for dataset download (only through burn portal)
     * @param from Address to burn from
     * @param amount Amount to burn
     */
    function burnForDownload(address from, uint256 amount) external onlyBurnPortal {
        require(isGraduated, "Not graduated yet");
        require(amount >= burnThreshold, "Insufficient burn amount");

        _burn(from, amount);

        emit BurnForDownload(from, amount, block.timestamp);
    }

    /**
     * @notice Get token decimals
     * @return Number of decimals
     */
    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    /**
     * @notice Calculate current supply reduction from burns
     * @return Percentage of supply burned (basis points)
     */
    function getSupplyReduction() external view returns (uint256) {
        uint256 currentSupply = totalSupply();
        uint256 burned = TOTAL_SUPPLY - currentSupply;
        return (burned * 10000) / TOTAL_SUPPLY; // In basis points
    }
}
