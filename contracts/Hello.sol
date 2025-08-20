// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title Hello contract example
/// @notice Minimal example contract for CLONES project
contract Hello {
    string private _greeting;

    constructor(string memory initialGreeting) {
        _greeting = initialGreeting;
    }

    function greet() external view returns (string memory) {
        return _greeting;
    }

    function setGreeting(string calldata newGreeting) external {
        _greeting = newGreeting;
    }
}
