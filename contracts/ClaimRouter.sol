// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ClaimRouter
 * @notice Batch claims router with factory validation and try/catch error handling
 * @dev Supports relaying pattern where account ≠ msg.sender with anti-phishing protection
 * @custom:security-contact security@clones.ai
 * @author CLONES
 */
contract ClaimRouter is ReentrancyGuard {
    // ----------- Custom Errors ----------- //
    error InvalidParameter(string param);
    error Unauthorized(string role);

    // ----------- State Variables ----------- //
    address public immutable timelock; // GOVERNANCE: Timelock multisig control
    uint256 public maxBatchSize = 20; // Configurable batch limit (start conservative)
    mapping(address => bool) public approvedFactories; // Registry of trusted factories

    // ----------- Structs ----------- //
    struct ClaimData {
        address vault;
        address account; // Account to pay (verified in signature)
        uint256 cumulativeAmount; // Cumulative pattern
        uint256 deadline;
        bytes signature; // Publisher's EIP-712
    }

    // ----------- Modifiers ----------- //
    modifier onlyTimelock() {
        if (msg.sender != timelock) revert Unauthorized("timelock");
        _;
    }

    // ----------- Constructor ----------- //
    constructor(address _timelock) {
        if (_timelock == address(0)) revert InvalidParameter("timelock");
        timelock = _timelock;
    }

    // ----------- Governance Functions ----------- //
    /**
     * @notice Manage factory allowlist - TIMELOCK CONTROLLED
     * @param factory Factory address
     * @param approved Whether factory is approved
     */
    function setFactoryApproved(address factory, bool approved) external onlyTimelock {
        if (factory == address(0)) revert InvalidParameter("factory");
        approvedFactories[factory] = approved;
        emit FactoryApprovalUpdated(factory, approved);
    }

    /**
     * @notice Update batch size as ecosystem scales - TIMELOCK CONTROLLED
     * @dev CRITICAL: This affects entire ecosystem scaling - requires governance consensus
     *      CURRENT HARD CAP 100 JUSTIFICATION (Base L2 30M gas blocks):
     *      - Gas Limit: 30M block limit / 110k per claim = ~270 theoretical max
     *      - Grief Protection: Large batches can DoS relayers with partial failures
     *      - RPC Limits: Most providers timeout >50-item batches due to processing overhead
     *      - UX: Desktop should split >100 claims into multiple transactions anyway
     * @param newMaxSize New maximum batch size (0 < newMaxSize <= 100)
     */
    function setMaxBatchSize(uint256 newMaxSize) external onlyTimelock {
        if (newMaxSize == 0 || newMaxSize > 100) revert InvalidParameter("batch_size");
        uint256 oldSize = maxBatchSize;
        maxBatchSize = newMaxSize;
        emit MaxBatchSizeUpdated(oldSize, newMaxSize);
    }

    // ----------- Claim Functions ----------- //
    /**
     * @notice Batch claim with best-effort semantics and factory validation
     * @dev CRITICAL: Best-effort semantics - paused vaults fail gracefully, others continue
     *      RELAY PATTERN: account ≠ msg.sender enables gas-sponsored relays and altruistic relaying
     *      ANTI-PHISHING: Validates vaults come from approved factories
     * @param claims Array of claim data
     * @return successful Number of successful claims
     * @return failed Number of failed claims
     */
    function claimAll(ClaimData[] calldata claims) external nonReentrant returns (uint256 successful, uint256 failed) {
        if (claims.length == 0 || claims.length > maxBatchSize) revert InvalidParameter("batch_size");

        uint256 totalGross = 0;
        uint256 totalFees = 0;
        uint256 totalNet = 0;

        for (uint256 i = 0; i < claims.length; i++) {
            // SECURITY: Validate vault factory before processing (anti-phishing)
            address vaultFactory;
            try IVaultClaim(claims[i].vault).getFactory() returns (address factory) {
                vaultFactory = factory;
                if (!approvedFactories[vaultFactory]) {
                    failed++;
                    emit ClaimFailed(claims[i].vault, claims[i].account, "Factory not approved");
                    continue;
                }
            } catch {
                failed++;
                emit ClaimFailed(claims[i].vault, claims[i].account, "Invalid vault or factory call failed");
                continue;
            }
            // Process claim after factory validation
            try
                IVaultClaim(claims[i].vault).payWithSig(
                    claims[i].account,
                    claims[i].cumulativeAmount,
                    claims[i].deadline,
                    claims[i].signature
                )
            returns (uint256 gross, uint256 fee, uint256 net) {
                successful++;
                totalGross += gross;
                totalFees += fee;
                totalNet += net;
                emit ClaimSucceeded(claims[i].vault, claims[i].account, vaultFactory, gross, fee, net);
            } catch Error(string memory reason) {
                failed++;
                // Common failure reasons help relayers and users understand issues:
                // - "Pausable: paused" (vault emergency paused)
                // - "Invalid signature" (bad EIP-712 signature)
                // - "Insufficient vault balance" (vault underfunded)
                // - "Already claimed" (cumulative amount ≤ already claimed)
                // - "Signature expired" (deadline < block.timestamp)
                // - "Deadline too far in future" (deadline > block.timestamp + 7 days)
                emit ClaimFailed(claims[i].vault, claims[i].account, reason);
            } catch {
                failed++;
                // Low-level failures: vault not a contract, out of gas, etc.
                emit ClaimFailed(claims[i].vault, claims[i].account, "Low-level failure");
            }
        }

        emit BatchClaimed(msg.sender, successful, failed, totalGross, totalFees, totalNet, block.timestamp);
    }

    // ----------- Events ----------- //
    event BatchClaimed(
        address indexed caller,
        uint256 successful,
        uint256 failed,
        uint256 totalGross,
        uint256 totalFees,
        uint256 totalNet,
        uint256 timestamp
    );
    event ClaimSucceeded(
        address indexed vault,
        address indexed account,
        address indexed factory,
        uint256 gross,
        uint256 fee,
        uint256 net
    );
    event ClaimFailed(address indexed vault, address indexed account, string reason);
    event FactoryApprovalUpdated(address indexed factory, bool approved);
    event MaxBatchSizeUpdated(uint256 oldSize, uint256 newSize);
}

/**
 * @title IVaultClaim
 * @notice Interface for vault claim operations
 */
interface IVaultClaim {
    function payWithSig(
        address account,
        uint256 cumulativeAmount,
        uint256 deadline,
        bytes calldata signature
    ) external returns (uint256 gross, uint256 fee, uint256 net);
    function getFactory() external view returns (address factory);
}
