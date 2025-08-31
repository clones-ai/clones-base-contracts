// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IAggregatorV3Interface} from "contracts/interfaces/IAggregatorV3Interface.sol";

/// @title MockSequencerUptimeFeed
/// @notice A mock for the Chainlink L2 Sequencer Uptime Feed.
/// @dev Allows setting the sequencer status for testing purposes.
/// @author CLONES
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

    /// @notice Get the number of decimals
    /// @return Number of decimals
    function decimals() external view override returns (uint8) {
        return DECIMALS;
    }

    /// @notice Get the description of the feed
    /// @return Description string
    function description() external view override returns (string memory) {
        return DESCRIPTION;
    }

    /// @notice Get the version of the feed
    /// @return Version number
    function version() external view override returns (uint256) {
        return VERSION;
    }

    /// @notice Get data for a specific round
    /// @return roundId Round ID
    /// @return answer Current answer
    /// @return startedAt Timestamp when round started
    /// @return updatedAt Timestamp when round was updated
    /// @return answeredInRound Round ID when answer was computed
    function getRoundData(
        uint80 /* _roundId */
    )
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (1, _answer, block.timestamp, block.timestamp, 1);
    }

    /// @notice Get data for the latest round
    /// @return roundId Round ID
    /// @return answer Current answer
    /// @return startedAt Timestamp when round started
    /// @return updatedAt Timestamp when round was updated
    /// @return answeredInRound Round ID when answer was computed
    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (1, _answer, block.timestamp, block.timestamp, 1);
    }
}
