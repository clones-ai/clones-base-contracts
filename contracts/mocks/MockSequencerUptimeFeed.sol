// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IAggregatorV3Interface} from "contracts/interfaces/IAggregatorV3Interface.sol";

/// @title MockSequencerUptimeFeed
/// @notice A mock for the Chainlink L2 Sequencer Uptime Feed.
/// @dev Allows setting the sequencer status for testing purposes.
contract MockSequencerUptimeFeed is IAggregatorV3Interface {
    int256 private _answer = 0; // 0 = up, 1 = down
    uint8 private constant DECIMALS = 0;
    string private constant DESCRIPTION = "Mock Sequencer Uptime Feed";
    uint256 private constant VERSION = 1;

    /// @notice Sets the current answer of the feed.
    /// @param newAnswer The new status (0 for up, 1 for down).
    function setAnswer(int256 newAnswer) public {
        _answer = newAnswer;
    }

    function decimals() external view override returns (uint8) {
        return DECIMALS;
    }

    function description() external view override returns (string memory) {
        return DESCRIPTION;
    }

    function version() external view override returns (uint256) {
        return VERSION;
    }

    function getRoundData(
        uint80
    )
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (1, _answer, block.timestamp, block.timestamp, 1);
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (1, _answer, block.timestamp, block.timestamp, 1);
    }
}
