// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "./lib/Ownable.sol";
import "./lib/ReentrancyGuard.sol";
import {DatasetToken} from "./DatasetToken.sol";
import {BondingCurvePool} from "./BondingCurvePool.sol";
import {DatasetRegistry} from "./DatasetRegistry.sol";
import {AggregatorV3Interface} from "./lib/ChainlinkInterfaces.sol";
import {IUniswapV2Router02, IUniswapV2Factory} from "./external/IUniswapV2Router02.sol";

contract DatasetFactory is Ownable, ReentrancyGuard {
    AggregatorV3Interface public immutable ethUsdOracle;
    address public immutable protocolFeeRecipient;
    DatasetRegistry public immutable registry;
    address public burnPortal;

    event DatasetLaunched(
        string id,
        string slug,
        address token,
        address pool,
        string metadataCID,
        string providerId,
        uint256 totalSupply,
        uint256 burnThreshold,
        uint256 vEth,
        uint256 vTok,
        uint256 launchedAt
    );
    event Graduated(string id, address token, address router, address pair);
    event BurnAccess(
        address indexed user,
        address indexed token,
        uint256 amount,
        string datasetCID,
        uint256 timestamp
    );

    constructor(
        AggregatorV3Interface _ethUsd,
        address _protocolFeeRecipient,
        DatasetRegistry _registry
    ) {
        ethUsdOracle = _ethUsd;
        protocolFeeRecipient = _protocolFeeRecipient;
        registry = _registry;
    }

    function setBurnPortal(address p) external onlyOwner {
        burnPortal = p;
    }

    function _latestEthPrice()
        internal
        view
        returns (uint256 price, uint8 dec)
    {
        (, int256 a, , , ) = ethUsdOracle.latestRoundData();
        require(a > 0, "ORACLE");
        price = uint256(a);
        dec = ethUsdOracle.decimals();
    }

    struct LaunchParams {
        string id;
        string slug;
        string name;
        string symbol;
        string metadataCID;
        string providerId;
        string qualityCID;
        uint256 totalSupply;
        uint256 burnThreshold;
        uint256 vEth;
        uint256 vTok;
        uint256 seedToCurve;
        uint256 targetMcUsdScaled;
        address creatorFeeRecipient;
        address router;
    }

    mapping(bytes32 => address) public tokenOf; // by id
    mapping(address => address) public poolOf; // token => pool

    function launchDataset(
        LaunchParams calldata p
    )
        external
        payable
        nonReentrant
        returns (address tokenAddr, address poolAddr)
    {
        require(msg.value >= 0.02 ether, "LIQ_FUND");
        bytes32 key = keccak256(bytes(p.id));
        require(tokenOf[key] == address(0), "ID_EXISTS");

        DatasetToken t = new DatasetToken(
            p.name,
            p.symbol,
            p.totalSupply,
            p.burnThreshold,
            msg.sender,
            p.metadataCID,
            p.qualityCID,
            address(this)
        );
        tokenAddr = address(t);
        BondingCurvePool pool = new BondingCurvePool(
            t,
            p.creatorFeeRecipient,
            protocolFeeRecipient,
            p.vEth,
            p.vTok,
            0
        );
        pool.transferOwnership(msg.sender);
        poolAddr = address(pool);

        tokenOf[key] = tokenAddr;
        poolOf[tokenAddr] = poolAddr;
        registry.register(
            p.id,
            p.slug,
            tokenAddr,
            msg.sender,
            p.metadataCID,
            p.providerId
        );

        emit DatasetLaunched(
            p.id,
            p.slug,
            tokenAddr,
            poolAddr,
            p.metadataCID,
            p.providerId,
            p.totalSupply,
            p.burnThreshold,
            p.vEth,
            p.vTok,
            block.timestamp
        );

        return (tokenAddr, poolAddr);
    }

    // creator must approve pool and call seedTokens(seedToCurve) off-chain after deploy

    function burnForAccess(
        address token,
        address user,
        uint256 amount
    ) external nonReentrant {
        require(msg.sender == burnPortal, "ONLY_PORTAL");
        DatasetToken t = DatasetToken(token);
        require(t.graduated(), "NOT_GRAD");
        require(amount >= t.burnThreshold(), "MIN_THRESHOLD");
        require(t.burnFrom(user, amount));
        emit BurnAccess(user, token, amount, t.datasetCID(), block.timestamp);
    }

    // Graduation (simplified; assumes creator pre-transferred reserved tokens to this factory)
    function graduate(string calldata id, address router) external nonReentrant {
        bytes32 k = keccak256(bytes(id));
        address tokenAddr = tokenOf[k];
        require(tokenAddr != address(0), "NO_ID");

        DatasetToken t = DatasetToken(tokenAddr);
        address payable pool = payable(poolOf[tokenAddr]);
        require(pool != address(0), "NO_POOL");

        t.setGraduated();
        BondingCurvePool(pool).markGraduated();

        IUniswapV2Router02 r = IUniswapV2Router02(router);
        address factory = r.factory();
        address weth = r.WETH();

        t.approve(address(r), type(uint256).max);
        r.addLiquidityETH{value: address(this).balance}(
            tokenAddr,
            t.balanceOf(address(this)),
            0,
            0,
            address(0xdead),
            block.timestamp + 3600
        );

        address pair = IUniswapV2Factory(factory).createPair(tokenAddr, weth);
        emit Graduated(id, tokenAddr, router, pair);
    }


    // ---------- Views for UI ----------
    struct BondingCurveView {
        uint256 currentPrice;
        uint256 totalSupply;
        uint256 virtualEthReserve;
        uint256 virtualTokenReserve;
        uint256 k;
        bool isGraduated;
        uint256 graduationThreshold;
    }

    function getBondingCurve(
        address tokenAddr,
        uint256 graduationThreshold
    ) external view returns (BondingCurveView memory v) {
        address payable p = payable(poolOf[tokenAddr]);
        require(p != address(0), "NO_POOL");
        BondingCurvePool pool = BondingCurvePool(p);
        DatasetToken t = DatasetToken(tokenAddr);
        v.currentPrice = pool.currentPriceEthPerToken();
        v.totalSupply = t.totalSupply();
        v.virtualEthReserve = pool.vEth();
        v.virtualTokenReserve = pool.vTok();
        v.k = pool.kVirtual();
        v.isGraduated = t.graduated();
        v.graduationThreshold = graduationThreshold; // supply via API/constant as needed
    }
}
