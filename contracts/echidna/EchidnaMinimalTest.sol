// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../mocks/TestToken.sol";

/**
 * @title EchidnaMinimalTest
 * @notice Ultra-minimal Echidna test to verify setup works
 * @dev Tests basic token operations without RewardPool complexity
 */
contract EchidnaMinimalTest {
    TestToken public token;
    uint256 public totalMinted;

    constructor() {
        token = new TestToken("Test", "TEST", 18);
        // Initial supply
        token.mint(address(this), 100 * 1e18);
        totalMinted = 100 * 1e18;
    }

    // Simple invariants
    function echidna_balance_positive() public view returns (bool) {
        return token.balanceOf(address(this)) >= 0;
    }

    function echidna_supply_consistent() public view returns (bool) {
        return token.totalSupply() == totalMinted;
    }

    // Simple fuzz function
    function fuzz_mint(uint256 amount) public {
        amount = 1 + (amount % (1000 * 1e18));
        token.mint(address(this), amount);
        totalMinted += amount;
    }
}
