/**
 * Backend Implementation Example: Pool Balance Validation
 * 
 * This module provides reference implementations for validating pool balances
 * and preventing creators from withdrawing funds allocated to farmers.
 */

import { ethers } from 'ethers';

// ============================================================================
// Types
// ============================================================================

interface PoolAllocation {
    poolAddress: string;
    farmerAddress: string;
    cumulativeAmount: bigint;
    alreadyClaimed: bigint;
    pendingAmount: bigint;
}

interface PoolState {
    address: string;
    creator: string;
    token: string;
    balance: bigint;
    totalAllocated: bigint;
    totalClaimed: bigint;
    totalPending: bigint;
    allocations: PoolAllocation[];
}

interface WithdrawalValidation {
    allowed: boolean;
    reason?: string;
    maxWithdrawable: bigint;
    safetyBuffer: bigint;
}

// ============================================================================
// Configuration
// ============================================================================

const SAFETY_BUFFER_PERCENT = 10; // 10% buffer for fees and safety
const PLATFORM_FEE_BPS = 1000; // 10% in basis points
const ALERT_THRESHOLD_PERCENT = 20; // Alert when balance drops below 20% of pending

// ============================================================================
// Core Validation Functions
// ============================================================================

/**
 * Calculate total pending claims for a pool
 */
export async function calculateTotalPending(
    poolAddress: string,
    db: any // Your database instance
): Promise<bigint> {
    // Get all allocations that haven't been fully claimed
    const allocations = await db.allocations.findMany({
        where: { poolAddress, status: 'ACTIVE' }
    });

    let totalPending = 0n;

    for (const allocation of allocations) {
        const pending = BigInt(allocation.cumulativeAmount) - BigInt(allocation.alreadyClaimed);
        totalPending += pending;
    }

    return totalPending;
}

/**
 * Get current pool state from blockchain and database
 */
export async function getPoolState(
    poolAddress: string,
    provider: ethers.Provider,
    db: any
): Promise<PoolState> {
    const poolContract = new ethers.Contract(
        poolAddress,
        ['function token() view returns (address)',
            'function creator() view returns (address)',
            'function globalAlreadyClaimed() view returns (uint256)'],
        provider
    );

    const [token, creator, globalClaimed] = await Promise.all([
        poolContract.token(),
        poolContract.creator(),
        poolContract.globalAlreadyClaimed()
    ]);

    const tokenContract = new ethers.Contract(
        token,
        ['function balanceOf(address) view returns (uint256)'],
        provider
    );

    const balance = await tokenContract.balanceOf(poolAddress);

    // Get allocations from database
    const allocations = await db.allocations.findMany({
        where: { poolAddress, status: 'ACTIVE' }
    });

    const poolAllocations: PoolAllocation[] = allocations.map((a: any) => ({
        poolAddress,
        farmerAddress: a.farmerAddress,
        cumulativeAmount: BigInt(a.cumulativeAmount),
        alreadyClaimed: BigInt(a.alreadyClaimed),
        pendingAmount: BigInt(a.cumulativeAmount) - BigInt(a.alreadyClaimed)
    }));

    const totalPending = poolAllocations.reduce(
        (sum, a) => sum + a.pendingAmount,
        0n
    );

    const totalAllocated = poolAllocations.reduce(
        (sum, a) => sum + a.cumulativeAmount,
        0n
    );

    return {
        address: poolAddress,
        creator,
        token,
        balance,
        totalAllocated,
        totalClaimed: globalClaimed,
        totalPending,
        allocations: poolAllocations
    };
}

/**
 * Validate if creator can withdraw a specific amount
 */
export function validateWithdrawal(
    poolState: PoolState,
    withdrawAmount: bigint
): WithdrawalValidation {
    // Calculate safety buffer (pending claims + platform fees)
    const pendingWithFees = (poolState.totalPending * BigInt(PLATFORM_FEE_BPS + 10000)) / 10000n;
    const safetyBuffer = (pendingWithFees * BigInt(SAFETY_BUFFER_PERCENT)) / 100n;
    const totalReserveNeeded = pendingWithFees + safetyBuffer;

    // Calculate maximum safe withdrawal
    const maxWithdrawable = poolState.balance > totalReserveNeeded
        ? poolState.balance - totalReserveNeeded
        : 0n;

    if (withdrawAmount > maxWithdrawable) {
        return {
            allowed: false,
            reason: `Withdrawal would leave insufficient funds for pending claims. Max withdrawable: ${ethers.formatEther(maxWithdrawable)}`,
            maxWithdrawable,
            safetyBuffer
        };
    }

    // Additional check: don't allow withdrawal if balance is already low
    if (poolState.balance < totalReserveNeeded) {
        return {
            allowed: false,
            reason: 'Pool balance is already below safe threshold for pending claims',
            maxWithdrawable: 0n,
            safetyBuffer
        };
    }

    return {
        allowed: true,
        maxWithdrawable,
        safetyBuffer
    };
}

/**
 * Check if pool balance is healthy before issuing a new allocation signature
 */
export async function validateNewAllocation(
    poolAddress: string,
    newAllocationAmount: bigint,
    provider: ethers.Provider,
    db: any
): Promise<{ allowed: boolean; reason?: string }> {
    const poolState = await getPoolState(poolAddress, provider, db);

    // Calculate what total pending would be after new allocation
    const futureTotal = poolState.totalPending + newAllocationAmount;
    const futureWithFees = (futureTotal * BigInt(PLATFORM_FEE_BPS + 10000)) / 10000n;

    if (poolState.balance < futureWithFees) {
        return {
            allowed: false,
            reason: `Insufficient pool balance. Current: ${ethers.formatEther(poolState.balance)}, Would need: ${ethers.formatEther(futureWithFees)}`
        };
    }

    return { allowed: true };
}

// ============================================================================
// Monitoring Functions
// ============================================================================

/**
 * Monitor pool health and alert if balance is too low
 */
export async function checkPoolHealth(
    poolAddress: string,
    provider: ethers.Provider,
    db: any
): Promise<{
    healthy: boolean;
    alerts: string[];
    metrics: {
        utilization: number; // percentage
        coverage: number; // how many times balance covers pending
    };
}> {
    const poolState = await getPoolState(poolAddress, provider, db);
    const alerts: string[] = [];

    if (poolState.totalPending === 0n) {
        return {
            healthy: true,
            alerts: [],
            metrics: { utilization: 0, coverage: Infinity }
        };
    }

    const pendingWithFees = (poolState.totalPending * BigInt(PLATFORM_FEE_BPS + 10000)) / 10000n;
    const coverage = Number(poolState.balance * 100n / pendingWithFees) / 100;
    const utilization = Number(poolState.totalPending * 100n / poolState.balance);

    // Alert if coverage is below 110%
    if (coverage < 1.1) {
        alerts.push(`⚠️ Low coverage: ${coverage.toFixed(2)}x (should be >1.1x)`);
    }

    // Alert if utilization is above 80%
    if (utilization > 80) {
        alerts.push(`⚠️ High utilization: ${utilization.toFixed(1)}% (should be <80%)`);
    }

    // Critical alert if balance can't cover pending
    if (poolState.balance < pendingWithFees) {
        alerts.push(`🚨 CRITICAL: Insufficient balance to cover pending claims!`);
    }

    return {
        healthy: alerts.length === 0,
        alerts,
        metrics: {
            utilization,
            coverage
        }
    };
}

/**
 * Handle withdrawal event from blockchain
 * Listens to the standard 'Withdrawn' event and performs health checks
 */
export async function handleWithdrawalEvent(
    event: {
        poolAddress: string;
        creator: string;
        token: string;
        amount: bigint;
    },
    provider: ethers.Provider,
    db: any
): Promise<void> {
    // Get pool state to know balance before withdrawal
    const poolState = await getPoolState(event.poolAddress, provider, db);
    const balanceBefore = poolState.balance + event.amount; // Current balance + amount withdrawn
    const balanceAfter = poolState.balance;

    // Check pool health after withdrawal
    const health = await checkPoolHealth(event.poolAddress, provider, db);

    if (!health.healthy) {
        console.error(`🚨 Pool ${event.poolAddress} unhealthy after withdrawal:`, health.alerts);

        // Pause new allocations for this pool
        await db.pools.update({
            where: { address: event.poolAddress },
            data: { status: 'PAUSED', pauseReason: 'INSUFFICIENT_BALANCE' }
        });

        // Flag creator
        await db.creators.update({
            where: { address: event.creator },
            data: {
                trustScore: { decrement: 20 },
                flags: {
                    push: {
                        type: 'UNSAFE_WITHDRAWAL',
                        poolAddress: event.poolAddress,
                        amount: event.amount.toString(),
                        timestamp: new Date()
                    }
                }
            }
        });

        // Send alerts
        await sendAlertToAdmins({
            type: 'POOL_HEALTH_CRITICAL',
            poolAddress: event.poolAddress,
            creator: event.creator,
            details: health
        });
    }

    // Log withdrawal
    await db.withdrawals.create({
        data: {
            poolAddress: event.poolAddress,
            creator: event.creator,
            amount: event.amount.toString(),
            balanceBefore: balanceBefore.toString(),
            balanceAfter: balanceAfter.toString(),
            timestamp: new Date()
        }
    });
}

// ============================================================================
// API Endpoint Examples
// ============================================================================

/**
 * Example API endpoint: Validate withdrawal before user submits transaction
 * GET /api/pools/:poolAddress/validate-withdrawal?amount=1000
 */
export async function apiValidateWithdrawal(
    poolAddress: string,
    amount: string,
    provider: ethers.Provider,
    db: any
): Promise<{
    success: boolean;
    allowed: boolean;
    validation: WithdrawalValidation;
}> {
    try {
        const poolState = await getPoolState(poolAddress, provider, db);
        const withdrawAmount = ethers.parseEther(amount);
        const validation = validateWithdrawal(poolState, withdrawAmount);

        return {
            success: true,
            allowed: validation.allowed,
            validation
        };
    } catch (error) {
        console.error('Error validating withdrawal:', error);
        return {
            success: false,
            allowed: false,
            validation: {
                allowed: false,
                reason: 'Internal error',
                maxWithdrawable: 0n,
                safetyBuffer: 0n
            }
        };
    }
}

/**
 * Example API endpoint: Get pool health status
 * GET /api/pools/:poolAddress/health
 */
export async function apiGetPoolHealth(
    poolAddress: string,
    provider: ethers.Provider,
    db: any
) {
    const [poolState, health] = await Promise.all([
        getPoolState(poolAddress, provider, db),
        checkPoolHealth(poolAddress, provider, db)
    ]);

    return {
        address: poolAddress,
        balance: ethers.formatEther(poolState.balance),
        totalPending: ethers.formatEther(poolState.totalPending),
        totalClaimed: ethers.formatEther(poolState.totalClaimed),
        health: health.healthy,
        alerts: health.alerts,
        metrics: health.metrics
    };
}

// ============================================================================
// Event Listening Setup
// ============================================================================

/**
 * Set up listener for withdrawal events
 * Example: Listen to 'Withdrawn' event from RewardPoolImplementation
 */
export function setupWithdrawalListener(
    poolAddress: string,
    provider: ethers.Provider,
    db: any
): void {
    const poolContract = new ethers.Contract(
        poolAddress,
        [
            'event Withdrawn(address indexed creator, address indexed token, uint256 indexed amount)'
        ],
        provider
    );

    // Listen to Withdrawn events
    poolContract.on('Withdrawn', async (creator: string, token: string, amount: bigint, event: any) => {
        console.log(`💰 Withdrawal detected: ${ethers.formatEther(amount)} tokens from pool ${poolAddress}`);

        try {
            await handleWithdrawalEvent(
                {
                    poolAddress,
                    creator,
                    token,
                    amount
                },
                provider,
                db
            );
        } catch (error) {
            console.error('Error handling withdrawal event:', error);
        }
    });

    console.log(`👂 Listening for withdrawals on pool: ${poolAddress}`);
}

/**
 * Set up listeners for all active pools
 */
export async function setupAllPoolListeners(
    provider: ethers.Provider,
    db: any
): Promise<void> {
    const activePools = await db.pools.findMany({
        where: { status: 'ACTIVE' }
    });

    for (const pool of activePools) {
        setupWithdrawalListener(pool.address, provider, db);
    }

    console.log(`✅ Set up listeners for ${activePools.length} pools`);
}

// ============================================================================
// Helper Functions
// ============================================================================

async function sendAlertToAdmins(alert: any): Promise<void> {
    // Implement your alert system (Slack, email, Discord, etc.)
    console.log('ADMIN ALERT:', alert);
}

export default {
    calculateTotalPending,
    getPoolState,
    validateWithdrawal,
    validateNewAllocation,
    checkPoolHealth,
    handleWithdrawalEvent,
    setupWithdrawalListener,
    setupAllPoolListeners,
    apiValidateWithdrawal,
    apiGetPoolHealth
};

