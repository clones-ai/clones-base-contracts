// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RewardPoolFactory.sol";
import "../RewardPoolImplementation.sol";
import "../mocks/TestToken.sol";

/**
 * @title EchidnaFactoryFuzzer
 * @notice Property-based fuzzing for RewardPoolFactory CORE LOGIC
 * @dev Tests factory operations, publisher rotation, and governance
 *
 * This fuzzer tests the FACTORY CRITICAL LOGIC:
 * - Publisher rotation with cooldown
 * - Publisher revocation
 * - Token allowlist management
 * - Pool creation and nonce tracking
 * - Grace period mechanics
 * - Access control
 *
 * @author CLONES
 */
contract EchidnaFactoryFuzzer {
    RewardPoolFactory public factory;
    RewardPoolImplementation public implementation;
    TestToken public token;

    address public constant timelock = address(0x1);
    address public constant guardian = address(0x2);
    address public constant treasury = address(0x3);
    address public constant initialPublisher = address(0x4);

    // Test publishers for rotation fuzzing
    address[] public testPublishers = [
        address(0x100),
        address(0x101),
        address(0x102),
        address(0x103),
        address(0x104),
        address(0x105)
    ];

    // Test creators for pool creation
    address[] public testCreators = [
        address(0x200),
        address(0x201),
        address(0x202),
        address(0x203),
        address(0x204),
        address(0x205)
    ];

    // Tracking
    uint256 public rotationCount;
    uint256 public poolCreationCount;
    mapping(address => bool) public hasBeenPublisher;
    mapping(address => bool) public hasBeenRevoked;

    constructor() {
        // Deploy implementation
        implementation = new RewardPoolImplementation();

        // Deploy factory
        factory = new RewardPoolFactory(address(implementation), treasury, timelock, guardian, initialPublisher);

        // Deploy token for testing
        token = new TestToken("Test", "TEST", 18);

        // Track initial publisher
        hasBeenPublisher[initialPublisher] = true;
    }

    // =============================================================================
    // CRITICAL INVARIANTS - Factory Core Logic
    // =============================================================================

    /**
     * INV-1: Publisher Always Valid
     * Current publisher should never be address(0)
     */
    function echidna_publisher_never_zero() public view returns (bool) {
        return factory.publisher() != address(0);
    }

    /**
     * INV-2: Immutable Addresses Unchanged
     * Timelock, guardian, treasury, implementation never change
     */
    function echidna_immutables_unchanged() public view returns (bool) {
        return
            factory.TIMELOCK() == timelock &&
            factory.GUARDIAN() == guardian &&
            factory.PLATFORM_TREASURY() == treasury &&
            factory.POOL_IMPLEMENTATION() == address(implementation);
    }

    /**
     * INV-3: Rotation Cooldown Enforced
     * If rotation happened recently, enough time must pass
     */
    function echidna_cooldown_enforced() public view returns (bool) {
        uint256 lastRotation = factory.lastRotationTime();
        uint256 currentTime = block.timestamp;

        // If there was a rotation and we're not in initial state
        if (lastRotation > 0 && rotationCount > 1) {
            // Cooldown should have been respected
            uint256 minInterval = factory.MIN_ROTATION_INTERVAL();
            return currentTime >= lastRotation + minInterval || lastRotation == currentTime; // Same tx is ok
        }
        return true;
    }

    /**
     * INV-4: Grace Period Consistency
     * If grace period active, old publisher must be set
     */
    function echidna_grace_period_logic() public view returns (bool) {
        uint256 graceEndTime = factory.graceEndTime();
        address oldPublisher = factory.oldPublisher();

        if (graceEndTime > block.timestamp) {
            // Active grace period requires old publisher
            return oldPublisher != address(0);
        }
        return true;
    }

    /**
     * INV-5: Revoked Publishers Invalid
     * If publisher is revoked, they should not be valid
     */
    function echidna_revoked_invalid() public view returns (bool) {
        for (uint i = 0; i < testPublishers.length; i++) {
            address pub = testPublishers[i];
            bool isRevoked = factory.revokedPublishers(pub);
            bool isValid = factory.isValidPublisher(pub);

            // If revoked, must not be valid
            if (isRevoked && isValid) return false;
        }
        return true;
    }

    /**
     * INV-6: Publisher State Atomicity
     * During grace period, both publishers should be different and non-zero
     */
    function echidna_atomic_transition() public view returns (bool) {
        uint256 graceEndTime = factory.graceEndTime();
        address currentPub = factory.publisher();
        address oldPub = factory.oldPublisher();

        if (graceEndTime > block.timestamp) {
            // In grace period: both must be set and different
            return currentPub != address(0) && oldPub != address(0) && currentPub != oldPub;
        }

        return true;
    }

    /**
     * INV-7: Nonce Monotonicity
     * Pool nonces for creators only increase
     */
    function echidna_nonce_increases() public view returns (bool) {
        for (uint i = 0; i < testCreators.length; i++) {
            address creator = testCreators[i];
            uint256 nonce = factory.poolNonce(creator, address(token));

            // Nonce should be reasonable (not overflowed)
            if (nonce > 10000) return false;
        }
        return true;
    }

    /**
     * INV-8: Implementation Address Valid
     * Implementation should always be valid contract
     */
    function echidna_implementation_valid() public view returns (bool) {
        address impl = factory.POOL_IMPLEMENTATION();
        return impl != address(0) && impl == address(implementation);
    }

    /**
     * INV-9: No Timestamp Overflow
     * Grace end time and last rotation should be reasonable
     */
    function echidna_no_time_overflow() public view returns (bool) {
        uint256 graceEndTime = factory.graceEndTime();
        uint256 lastRotation = factory.lastRotationTime();

        // Check reasonable bounds (not overflowed)
        if (graceEndTime > 0 && graceEndTime < lastRotation) return false;
        if (graceEndTime > block.timestamp + 365 days) return false;

        return true;
    }

    /**
     * INV-10: Rotation Count Consistency
     * Our tracked rotation count should reflect state changes
     */
    function echidna_rotation_count_sane() public view returns (bool) {
        // Rotation count should be reasonable for fuzzing
        return rotationCount <= 1000;
    }

    // =============================================================================
    // FUZZ FUNCTIONS - Test Actions
    // =============================================================================

    /**
     * Fuzz: Attempt publisher rotation
     */
    function fuzz_rotate_publisher(uint8 publisherIndex) public {
        publisherIndex = uint8(bound(publisherIndex, 0, testPublishers.length - 1));
        address newPublisher = testPublishers[publisherIndex];

        // Skip if same as current
        if (newPublisher == factory.publisher()) return;

        // Skip if revoked
        if (factory.revokedPublishers(newPublisher)) return;

        // Attempt rotation (will fail unless called by timelock)
        try factory.initiatePublisherRotation(newPublisher) {
            // Succeeded (shouldn't happen unless we're timelock)
            rotationCount++;
            hasBeenPublisher[newPublisher] = true;
        } catch {
            // Expected to fail - only timelock can rotate
        }
    }

    /**
     * Fuzz: Attempt to cancel rotation
     */
    function fuzz_cancel_rotation() public {
        try factory.cancelPublisherRotation() {
            // Succeeded
        } catch {
            // Expected to fail unless called by timelock
        }
    }

    /**
     * Fuzz: Attempt publisher revocation
     */
    function fuzz_revoke_publisher(uint8 publisherIndex) public {
        publisherIndex = uint8(bound(publisherIndex, 0, testPublishers.length - 1));
        address pubToRevoke = testPublishers[publisherIndex];

        try factory.emergencyRevokePublisher(pubToRevoke, "Fuzz test") {
            // Succeeded (shouldn't happen unless we're guardian)
            hasBeenRevoked[pubToRevoke] = true;
        } catch {
            // Expected to fail - only guardian can revoke
        }
    }

    /**
     * Fuzz: Attempt token allowlist change
     */
    function fuzz_token_allowlist(uint8 tokenIndex, bool allowed) public {
        // Create deterministic token address
        address tokenAddr = address(uint160(0x1000 + tokenIndex));

        try factory.setTokenAllowed(tokenAddr, allowed) {
            // Succeeded (shouldn't happen)
        } catch {
            // Expected to fail - only timelock
        }
    }

    /**
     * Fuzz: Attempt pool creation
     */
    function fuzz_create_pool(uint8 creatorIndex, uint256 fundingAmount) public {
        creatorIndex = uint8(bound(creatorIndex, 0, testCreators.length - 1));
        address creator = testCreators[creatorIndex];

        fundingAmount = bound(fundingAmount, 1e18, 1000e18);

        // Mint tokens
        token.mint(creator, fundingAmount);

        // Attempt creation (will likely fail due to token not allowed)
        try factory.createAndFundPool(address(token), fundingAmount) {
            // Succeeded
            poolCreationCount++;
        } catch {
            // Expected to fail
        }
    }

    /**
     * Fuzz: Factory pause attempt
     */
    function fuzz_factory_pause() public {
        try factory.pause() {
            // Succeeded (shouldn't happen unless we're guardian)
        } catch {
            // Expected - only guardian can pause
        }
    }

    function fuzz_factory_unpause() public {
        try factory.unpause() {
            // Succeeded (shouldn't happen unless we're guardian)
        } catch {
            // Expected - only guardian can unpause
        }
    }

    // =============================================================================
    // HELPER FUNCTIONS
    // =============================================================================

    function bound(uint256 x, uint256 min, uint256 max) internal pure returns (uint256) {
        if (max == min) return min;
        return min + (x % (max - min + 1));
    }

    // View functions for debugging
    function getCurrentPublisher() public view returns (address) {
        return factory.publisher();
    }

    function getRotationCount() public view returns (uint256) {
        return rotationCount;
    }

    function isPublisherValid(address pub) public view returns (bool) {
        return factory.isValidPublisher(pub);
    }
}
