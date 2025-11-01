// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

library MathEx {
    // k = (E + vE)*(T + vT)
    // buy: given deltaE (ethInMinusFees), compute tokensOut
    function tokensOutFromEth(
        uint256 ethReserve,
        uint256 tokReserve,
        uint256 vEth,
        uint256 vTok,
        uint256 ethIn
    ) internal pure returns (uint256 out) {
        // newEth = ethReserve + ethIn
        uint256 newEth = ethReserve + ethIn;
        // k = (ethReserve + vEth) * (tokReserve + vTok)
        uint256 k = (ethReserve + vEth) * (tokReserve + vTok);
        // newTokVirtual = k / (newEth + vEth)
        uint256 newTokVirtual = k / (newEth + vEth);
        // newTok = newTokVirtual - vTok
        uint256 newTok = newTokVirtual > vTok ? newTokVirtual - vTok : 0;
        // out = tokReserve - newTok
        out = tokReserve > newTok ? tokReserve - newTok : 0;
    }
}
