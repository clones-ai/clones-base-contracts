// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title FeeOnTransferToken
/// @notice An ERC20 token that charges a fee on every transfer, used for testing purposes.
contract FeeOnTransferToken is ERC20 {
    uint256 public constant FEE_BASIS_POINTS = 100; // 1% fee
    uint256 public constant MAX_BASIS_POINTS = 10000;

    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override {
        if (from == address(0) || to == address(0)) {
            super._update(from, to, value);
            return;
        }

        uint256 fee = (value * FEE_BASIS_POINTS) / MAX_BASIS_POINTS;
        uint256 amountAfterFee = value - fee;

        // The sender pays the fee, receiver gets the amount after fee.
        // The fee is effectively burned in this mock.
        super._update(from, to, amountAfterFee);
    }
}
