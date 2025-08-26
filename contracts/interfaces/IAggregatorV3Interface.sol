// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title IAggregatorV3Interface
 * @notice Interface for the Chainlink Aggregator V3.
 * @author Chainlink
 */
interface IAggregatorV3Interface {
    /**
     * @notice Get the number of decimals for the price feed.
     * @return The number of decimals.
     */
    function decimals() external view returns (uint8);

    /**
     * @notice Get a description of the price feed.
     * @return The description string.
     */
    function description() external view returns (string memory);

    /**
     * @notice Get the version of the price feed.
     * @return The version number.
     */
    function version() external view returns (uint256);

    /**
     * @notice Get the data for a specific round.
     * @param _roundId The ID of the round to retrieve.
     * @return roundId The round ID.
     * @return answer The price.
     * @return startedAt Timestamp of when the round started.
     * @return updatedAt Timestamp of when the round was updated.
     * @return answeredInRound The round ID in which the answer was computed.
     */
    function getRoundData(
        uint80 _roundId
    )
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);

    /**
     * @notice Get the latest round data.
     * @return roundId The round ID.
     * @return answer The price.
     * @return startedAt Timestamp of when the round started.
     * @return updatedAt Timestamp of when the round was updated.
     * @return answeredInRound The round ID in which the answer was computed.
     */
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
