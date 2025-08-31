// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title TestToken
/// @notice Minimal mintable ERC20 with custom decimals and permit support for testing
/// @author CLONES
contract TestToken is ERC20, ERC20Permit {
    uint8 private immutable _DECIMALS;

    /// @notice Initialize TestToken with custom decimals
    /// @param name_ Token name
    /// @param symbol_ Token symbol
    /// @param decimals_ Number of decimals
    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) ERC20Permit(name_) {
        _DECIMALS = decimals_;
    }

    /// @notice Get the number of decimals for this token
    /// @return Number of decimals
    function decimals() public view override returns (uint8) {
        return _DECIMALS;
    }

    /// @notice Mint tokens to an address
    /// @param to Address to mint tokens to
    /// @param amount Amount of tokens to mint
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
