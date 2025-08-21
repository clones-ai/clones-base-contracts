// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {AggregatorV3Interface} from "contracts/RewardPool.sol";

/// @title MockSequencerUptimeFeed
/// @notice A mock for the Chainlink L2 Sequencer Uptime Feed.
/// @dev Allows setting the sequencer status for testing purposes.
contract MockSequencerUptimeFeed is AggregatorV3Interface {
    int256 private _answer = 0; // 0 = up, 1 = down
    uint8 private _decimals = 0;
    string private _description = "Mock Sequencer Uptime Feed";
    uint256 private _version = 1;

    /// @notice Sets the current answer of the feed.
    /// @param newAnswer The new status (0 for up, 1 for down).
    function setAnswer(int256 newAnswer) public {
        _answer = newAnswer;
    }

    function decimals() external view override returns (uint8) {
        return _decimals;
    }

    function description() external view override returns (string memory) {
        return _description;
    }

    function version() external view override returns (uint256) {
        return _version;
    }

    function getRoundData(
        uint80
    )
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (1, _answer, block.timestamp, block.timestamp, 1);
    }

    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (1, _answer, block.timestamp, block.timestamp, 1);
    }
}
