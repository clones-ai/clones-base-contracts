// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title FeeOnTransferToken
/// @notice An ERC20 token that charges a fee on every transfer, used for testing purposes.
/// @author CLONES
contract FeeOnTransferToken is ERC20 {
    /// @notice Fee charged on transfers in basis points (1%)
    uint256 public constant FEE_BASIS_POINTS = 100; // 1% fee
    /// @notice Maximum basis points for percentage calculations
    uint256 public constant MAX_BASIS_POINTS = 10000;

    /// @notice Initialize the FeeOnTransferToken
    /// @param name Token name
    /// @param symbol Token symbol
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    /// @notice Mint tokens to an address
    /// @param to Address to mint tokens to
    /// @param amount Amount of tokens to mint
    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

    /// @notice Internal update function that applies transfer fees
    /// @param from Sender address
    /// @param to Recipient address
    /// @param value Amount to transfer
    function _update(address from, address to, uint256 value) internal override {
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
