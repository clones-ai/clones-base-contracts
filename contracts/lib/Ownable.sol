// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

abstract contract Ownable {
    address public owner;
    event OwnershipTransferred(address indexed prev, address indexed curr);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    function transferOwnership(address n) external onlyOwner {
        emit OwnershipTransferred(owner, n);
        owner = n;
    }
}
