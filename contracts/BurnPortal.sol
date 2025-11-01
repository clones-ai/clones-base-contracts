// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "./lib/Ownable.sol";
import "./lib/ReentrancyGuard.sol";

interface IFactoryBurner {
    function burnForAccess(
        address token,
        address user,
        uint256 amount
    ) external;
}

contract BurnPortal is Ownable, ReentrancyGuard {
    IFactoryBurner public factory;
    event BurnRequested(
        address indexed user,
        address indexed token,
        uint256 amount
    );

    function setFactory(address f) external onlyOwner {
        factory = IFactoryBurner(f);
    }

    function requestBurn(address token, uint256 amount) external nonReentrant {
        emit BurnRequested(msg.sender, token, amount);
        factory.burnForAccess(token, msg.sender, amount);
    }
}
