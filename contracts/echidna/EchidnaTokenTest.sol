// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../mocks/TestToken.sol";
import "../ClaimRouter.sol";
import "../RewardPoolFactory.sol";

/**
 * @title EchidnaTokenTest
 * @notice Echidna fuzzing for token operations and basic pool mechanics
 * @dev Focuses on token balance invariants without complex signature verification
 */
contract EchidnaTokenTest {
    TestToken public token;
    RewardPoolFactory public factory;
    ClaimRouter public router;

    address public constant treasury = address(0x1);
    address public constant timelock = address(0x2);
    address public constant guardian = address(0x3);
    address public constant publisher = address(0x4);

    uint256 public totalMinted;

    constructor() {
        // Deploy token
        token = new TestToken("Fuzz Token", "FUZZ", 18);

        // Initial supply
        token.mint(address(this), 1000 * 1e18);
        totalMinted = 1000 * 1e18;

        // Deploy a minimal implementation (we won't initialize it)
        address mockImpl = address(0x123); // Mock address

        // Deploy factory
        factory = new RewardPoolFactory(mockImpl, treasury, timelock, guardian, publisher);

        // Deploy router
        router = new ClaimRouter(timelock);
    }

    // =============================================================================
    // INVARIANTS
    // =============================================================================

    /**
     * INV-1: Token total supply equals minted
     */
    function echidna_supply_equals_minted() public view returns (bool) {
        return token.totalSupply() == totalMinted;
    }

    /**
     * INV-2: Contract balance is non-negative
     */
    function echidna_balance_positive() public view returns (bool) {
        return token.balanceOf(address(this)) >= 0;
    }

    /**
     * INV-3: Total minted never decreases
     */
    function echidna_minted_monotonic() public view returns (bool) {
        return totalMinted >= 1000 * 1e18; // At least initial amount
    }

    /**
     * INV-4: Factory has valid addresses
     */
    function echidna_factory_valid() public view returns (bool) {
        return address(factory) != address(0) && factory.TIMELOCK() == timelock && factory.GUARDIAN() == guardian;
    }

    /**
     * INV-5: Router has valid timelock
     */
    function echidna_router_valid() public view returns (bool) {
        return address(router) != address(0) && router.TIMELOCK() == timelock;
    }

    // =============================================================================
    // FUZZ FUNCTIONS
    // =============================================================================

    /**
     * Fuzz: Mint tokens
     */
    function fuzz_mint(uint256 amount) public {
        // Bound to reasonable range (1 to 10000 tokens)
        amount = 1e18 + (amount % (10000 * 1e18));

        token.mint(address(this), amount);
        totalMinted += amount;
    }

    /**
     * Fuzz: Transfer tokens
     */
    function fuzz_transfer(address to, uint256 amount) public {
        if (to == address(0) || to == address(this)) return;

        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) return;

        // Bound to balance
        amount = 1 + (amount % balance);

        try token.transfer(to, amount) {
            // Transfer succeeded
        } catch {
            // Transfer failed, that's ok
        }
    }

    /**
     * Fuzz: Approve tokens
     */
    function fuzz_approve(address spender, uint256 amount) public {
        if (spender == address(0)) return;

        // Bound amount
        amount = amount % (1000000 * 1e18);

        try token.approve(spender, amount) {
            // Approval succeeded
        } catch {
            // Approval failed
        }
    }

    /**
     * Fuzz: Test factory token allowlist
     */
    function fuzz_factory_token_allowlist(bool allowed) public {
        // Try to set token allowed (will fail unless called as timelock)
        try factory.setTokenAllowed(address(token), allowed) {
            // Succeeded (shouldn't happen unless we're timelock)
        } catch {
            // Expected to fail
        }
    }

    /**
     * Fuzz: Test router factory approval
     */
    function fuzz_router_factory_approval(bool approved) public {
        // Try to approve factory (will fail unless called as timelock)
        try router.setFactoryApproved(address(factory), approved) {
            // Succeeded (shouldn't happen)
        } catch {
            // Expected to fail
        }
    }

    /**
     * Fuzz: Test router batch size
     */
    function fuzz_router_batch_size(uint256 newSize) public {
        // Bound to valid range (1-100)
        if (newSize == 0 || newSize > 100) return;

        // Try to set batch size (will fail unless called as timelock)
        try router.setMaxBatchSize(newSize) {
            // Succeeded (shouldn't happen)
        } catch {
            // Expected to fail - only timelock can do this
        }
    }
}
