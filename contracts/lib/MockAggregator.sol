// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

contract MockAggregator {
    int256 private _price;
    uint8  private _decimals;

    constructor(int256 initialPrice, uint8 decimals_) {
        _price = initialPrice;
        _decimals = decimals_;
    }

    function decimals() external view returns (uint8) { return _decimals; }

    // Chainlink-compatible signature slice
    function latestRoundData()
        external
        view
        returns (
            uint80, int256 answer, uint256, uint256, uint80
        )
    {
        return (0, _price, block.timestamp, block.timestamp, 0);
    }

    // helper to change price in tests
    function setPrice(int256 p) external { _price = p; }
}
