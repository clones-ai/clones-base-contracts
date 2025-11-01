// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "./lib/Ownable.sol";
import "./lib/ReentrancyGuard.sol";
import {DatasetToken} from "./DatasetToken.sol";
import {MathEx} from "./utils/MathEx.sol";

contract BondingCurvePool is Ownable, ReentrancyGuard {
    using MathEx for uint256;

    DatasetToken public immutable token;
    address public immutable feeRecipientCreator;
    address public immutable feeRecipientProtocol;
    uint256 public immutable vEth;
    uint256 public immutable vTok;
    uint256 public ethReserve;
    uint256 public tokReserve;
    bool public tradingEnabled = true;
    bool public graduated;

    event Buy(
        address indexed buyer,
        uint256 ethIn,
        uint256 tokensOut,
        uint256 priceEthPerToken,
        uint256 kVirtual,
        uint256 timestamp
    );

    constructor(
        DatasetToken _token,
        address _creatorFee,
        address _protocolFee,
        uint256 _vEth,
        uint256 _vTok,
        uint256 _initTokReserve
    ) {
        token = _token;
        feeRecipientCreator = _creatorFee;
        feeRecipientProtocol = _protocolFee;
        vEth = _vEth;
        vTok = _vTok;
        tokReserve = _initTokReserve;
    }

    receive() external payable {}

    function currentPriceEthPerToken() public view returns (uint256) {
        // scaled 1e18
        return ((ethReserve + vEth) * 1e18) / (tokReserve + vTok);
    }

    function kVirtual() public view returns (uint256) {
        return (ethReserve + vEth) * (tokReserve + vTok);
    }

    function buy() external payable nonReentrant {
        require(tradingEnabled && !graduated, "NOT_ALLOWED");
        require(msg.value > 0, "NO_ETH");
        uint256 feeCreator = (msg.value * 25) / 10_000;
        uint256 feeProtocol = (msg.value * 75) / 10_000;
        uint256 ethIn = msg.value - feeCreator - feeProtocol;
        uint256 out = MathEx.tokensOutFromEth(
            ethReserve,
            tokReserve,
            vEth,
            vTok,
            ethIn
        );
        require(out > 0 && out <= tokReserve, "OUT");
        ethReserve += ethIn;
        tokReserve -= out;
        (bool s1, ) = feeRecipientCreator.call{value: feeCreator}("");
        require(s1, "FEE1");
        (bool s2, ) = feeRecipientProtocol.call{value: feeProtocol}("");
        require(s2, "FEE2");
        require(token.transfer(msg.sender, out));
        emit Buy(
            msg.sender,
            ethIn,
            out,
            currentPriceEthPerToken(),
            kVirtual(),
            block.timestamp
        );
    }

    function seedTokens(uint256 amount) external onlyOwner {
        require(!graduated && tokReserve == 0, "SEEDED");
        require(token.transferFrom(msg.sender, address(this), amount));
        tokReserve = amount;
    }

    function markGraduated() external onlyOwner {
        graduated = true;
        tradingEnabled = false;
    }
}
