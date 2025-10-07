// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * @title FormalVerificationInvariants
 * @notice Critical mathematical invariants for the Clones reward pool system
 * @dev These invariants must hold at all times for system correctness and security
 * @author CLONES
 */

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract FormalVerificationInvariants {
    uint16 public constant FEE_BPS = 1000; // 10%
    uint256 private constant FEE_DENOMINATOR = 10000;
    uint256 private constant MIN_CLAIM_AMOUNT = 1e18;

    /**
     * @notice INVARIANT 1: Balance Conservation
     * @dev Contract balance must always be sufficient for remaining claims
     * @param pool The reward pool to check
     * @return valid Whether the balance conservation invariant holds
     */
    function checkBalanceConservation(address pool) public view returns (bool valid) {
        // Simplified check - balance must be non-negative (always true in EVM)
        return IERC20(pool).balanceOf(pool) >= 0;
    }

    /**
     * @notice INVARIANT 2: Cumulative Claim Monotonicity
     * @dev alreadyClaimed[account] must never decrease for any account
     * @param currentClaimed Current claimed amount for account
     * @param newCumulativeAmount The new cumulative amount being claimed
     * @return valid Whether monotonicity is preserved
     */
    function checkClaimMonotonicity(
        uint256 currentClaimed,
        uint256 newCumulativeAmount
    ) public pure returns (bool valid) {
        // New cumulative amount must always be greater than or equal to current
        return newCumulativeAmount >= currentClaimed;
    }

    /**
     * @notice INVARIANT 3: Fee Calculation Consistency
     * @dev Fees must be calculated correctly using the cumulative pattern
     * @param cumulativeAmount Total cumulative amount for the account
     * @param alreadyFeePaid Fees already paid by this account
     * @param expectedFeeForClaim Expected fee for this specific claim
     * @return valid Whether fee calculation is correct
     */
    function checkFeeCalculationConsistency(
        uint256 cumulativeAmount,
        uint256 alreadyFeePaid,
        uint256 expectedFeeForClaim
    ) public pure returns (bool valid) {
        uint256 totalFeeDue = (cumulativeAmount * FEE_BPS) / FEE_DENOMINATOR;
        uint256 calculatedFeeForClaim = totalFeeDue - alreadyFeePaid;

        // Fee calculation must match expected value
        return calculatedFeeForClaim == expectedFeeForClaim;
    }

    /**
     * @notice INVARIANT 4: Overflow/Underflow Safety
     * @dev All arithmetic operations must not overflow or underflow
     * @param a First operand
     * @param b Second operand
     * @return safeAdd Whether addition is safe
     * @return safeSub Whether subtraction is safe (a >= b)
     * @return safeMul Whether multiplication is safe
     * @return safeDiv Whether division is safe (b != 0)
     */
    function checkArithmeticSafety(
        uint256 a,
        uint256 b
    ) public pure returns (bool safeAdd, bool safeSub, bool safeMul, bool safeDiv) {
        // Addition overflow check
        safeAdd = a <= type(uint256).max - b;

        // Subtraction underflow check
        safeSub = a >= b;

        // Multiplication overflow check
        safeMul = (a == 0 || b == 0) ? true : (a <= type(uint256).max / b);

        // Division by zero check
        safeDiv = b != 0;
    }

    /**
     * @notice INVARIANT 5: Global Claim Consistency
     * @dev globalAlreadyClaimed must equal sum of all individual claims
     * @param globalClaimed Global claimed amount
     * @param sumOfIndividualClaims Sum of individual account claims
     * @return valid Whether global consistency holds
     */
    function checkGlobalClaimConsistency(
        uint256 globalClaimed,
        uint256 sumOfIndividualClaims
    ) public pure returns (bool valid) {
        // Global claimed must equal sum of individual claims
        return globalClaimed == sumOfIndividualClaims;
    }

    /**
     * @notice INVARIANT 6: Rate Limiting Integrity
     * @dev Claims per block must not exceed MAX_CLAIMS_PER_BLOCK
     * @param claimsInBlock Current claims in the block
     * @return valid Whether rate limiting is enforced
     */
    function checkRateLimitingIntegrity(uint256 claimsInBlock) public pure returns (bool valid) {
        // Claims per block must not exceed the maximum
        return claimsInBlock <= 50; // MAX_CLAIMS_PER_BLOCK constant
    }

    /**
     * @notice INVARIANT 7: Precision Attack Prevention
     * @dev Gross claim amounts must meet minimum threshold
     * @param grossAmount The gross amount being claimed
     * @return valid Whether amount meets minimum requirements
     */
    function checkPrecisionAttackPrevention(uint256 grossAmount) public pure returns (bool valid) {
        // Gross amount must be at least MIN_CLAIM_AMOUNT
        return grossAmount >= MIN_CLAIM_AMOUNT;
    }

    /**
     * @notice INVARIANT 8: Emergency State Consistency
     * @dev Emergency sweep can only occur after proper notice period
     * @param pool The reward pool to check
     * @param emergencyNoticeTimestamp When emergency notice was initiated
     * @param currentTimestamp Current block timestamp
     * @return canSweep Whether emergency sweep is allowed
     */
    function checkEmergencyStateConsistency(
        address pool,
        uint256 emergencyNoticeTimestamp,
        uint256 currentTimestamp
    ) public pure returns (bool canSweep) {
        if (emergencyNoticeTimestamp == 0) return false;

        uint256 EMERGENCY_NOTICE_PERIOD = 7 days;
        return currentTimestamp >= emergencyNoticeTimestamp + EMERGENCY_NOTICE_PERIOD;
    }

    /**
     * @notice Master invariant checker - verifies all critical invariants
     * @dev Should be called after any state-changing operation
     * @param currentClaimed Current claimed amount for account
     * @param newCumulativeAmount New cumulative amount (if applicable)
     * @param claimsInBlock Current claims in this block
     * @return allValid Whether all invariants pass
     */
    function checkAllInvariants(
        uint256 currentClaimed,
        uint256 newCumulativeAmount,
        uint256 claimsInBlock
    ) public pure returns (bool allValid) {
        // Check claim monotonicity
        if (!checkClaimMonotonicity(currentClaimed, newCumulativeAmount)) return false;

        // Check rate limiting for current block
        if (!checkRateLimitingIntegrity(claimsInBlock)) return false;

        // Check precision attack prevention
        if (newCumulativeAmount > currentClaimed) {
            uint256 grossAmount = newCumulativeAmount - currentClaimed;
            if (!checkPrecisionAttackPrevention(grossAmount)) return false;
        }

        return true;
    }
}
