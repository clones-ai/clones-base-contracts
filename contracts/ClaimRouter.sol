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
    /// @notice Timelock multisig control address
    address public immutable TIMELOCK; // GOVERNANCE: Timelock multisig control
    /// @notice Maximum number of claims that can be processed in a single batch
    uint256 public maxBatchSize = 20; // Configurable batch limit (start conservative)
    /// @notice Maximum gas allowed per individual claim to prevent griefing
    uint256 public maxGasPerClaim = 200000; // 200k gas limit per claim
    /// @notice Registry of trusted factory addresses
    mapping(address => bool) public approvedFactories; // Registry of trusted factories

    // ----------- Structs ----------- //
    struct ClaimData {
        address vault;
        address account; // Account to pay (verified in signature)
        uint256 cumulativeAmount; // Cumulative pattern
        uint256 nonce; // Nonce for replay protection
        bytes signature; // Publisher's EIP-712
    }

    // ----------- Modifiers ----------- //
    modifier onlyTimelock() {
        if (msg.sender != TIMELOCK) revert Unauthorized("timelock");
        _;
    }

    // ----------- Constructor ----------- //
    /// @notice Initialize the ClaimRouter with timelock address
    /// @param _timelock Address of the timelock contract for governance
    constructor(address _timelock) {
        if (_timelock == address(0)) revert InvalidParameter("timelock");
        TIMELOCK = _timelock;
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

    /**
     * @notice Update maximum gas per claim to prevent griefing attacks
     * @param newMaxGasPerClaim New maximum gas per claim (50k to 500k range)
     */
    function setMaxGasPerClaim(uint256 newMaxGasPerClaim) external onlyTimelock {
        if (newMaxGasPerClaim < 50000 || newMaxGasPerClaim > 500000) revert InvalidParameter("gas_limit");
        uint256 oldGasLimit = maxGasPerClaim;
        maxGasPerClaim = newMaxGasPerClaim;
        emit MaxGasPerClaimUpdated(oldGasLimit, newMaxGasPerClaim);
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
        uint256 claimsLength = claims.length;
        if (claimsLength == 0 || claimsLength > maxBatchSize) revert InvalidParameter("batch_size");

        uint256 totalGross = 0;
        uint256 totalFees = 0;
        uint256 totalNet = 0;

        // BATCH OPTIMIZATION: Pre-validate all factories (saves 20k gas/batch)
        address[] memory vaultFactories = new address[](claimsLength);
        for (uint256 i = 0; i < claimsLength; ) {
            try IVaultClaim(claims[i].vault).getFactory() returns (address factory) {
                if (!approvedFactories[factory]) {
                    ++failed;
                    emit ClaimFailed(claims[i].vault, claims[i].account, "Factory not approved");
                    vaultFactories[i] = address(0); // Mark as invalid
                } else {
                    vaultFactories[i] = factory;
                }
            } catch {
                ++failed;
                emit ClaimFailed(claims[i].vault, claims[i].account, "Invalid vault");
                vaultFactories[i] = address(0); // Mark as invalid
            }
            unchecked {
                ++i;
            }
        }

        // Process claims for valid vaults only with gas monitoring
        for (uint256 i = 0; i < claimsLength; ) {
            if (vaultFactories[i] != address(0)) {
                (uint256 gross, uint256 fee, uint256 net, bool success) = _processSingleClaim(
                    claims[i],
                    vaultFactories[i]
                );
                if (success) {
                    ++successful;
                    totalGross += gross;
                    totalFees += fee;
                    totalNet += net;
                } else {
                    ++failed;
                }
            }
            unchecked {
                ++i;
            }
        }

        emit BatchClaimed(msg.sender, successful, failed, totalGross, totalFees, totalNet, block.timestamp);
    }

    // ----------- Internal Functions ----------- //
    /**
     * @notice Process a single claim (reduces stack depth)
     * @param claim Claim data
     * @param factory Factory address for this vault
     * @return gross Gross amount
     * @return fee Fee amount
     * @return net Net amount
     * @return success Whether claim succeeded
     */
    function _processSingleClaim(
        ClaimData calldata claim,
        address factory
    ) internal returns (uint256 gross, uint256 fee, uint256 net, bool success) {
        uint256 gasBefore = gasleft();

        try
            IVaultClaim(claim.vault).payWithSig(claim.account, claim.cumulativeAmount, claim.nonce, claim.signature)
        returns (uint256 _gross, uint256 _fee, uint256 _net) {
            if ((gasBefore - gasleft()) > maxGasPerClaim) {
                emit ClaimFailed(claim.vault, claim.account, "Excessive gas usage detected");
                return (0, 0, 0, false);
            } else {
                emit ClaimSucceeded(claim.vault, claim.account, factory, _gross, _fee, _net);
                return (_gross, _fee, _net, true);
            }
        } catch Error(string memory reason) {
            emit ClaimFailed(claim.vault, claim.account, reason);
            return (0, 0, 0, false);
        } catch {
            emit ClaimFailed(claim.vault, claim.account, "Low-level failure");
            return (0, 0, 0, false);
        }
    }

    // ----------- Events ----------- //
    /// @notice Emitted when a batch of claims is processed
    /// @param caller Address that initiated the batch claim
    /// @param successful Number of successful claims
    /// @param failed Number of failed claims
    /// @param totalGross Total gross amount claimed
    /// @param totalFees Total fees collected
    /// @param totalNet Total net amount distributed
    /// @param timestamp Block timestamp of the batch
    event BatchClaimed(
        address indexed caller,
        uint256 indexed successful,
        uint256 indexed failed,
        uint256 totalGross,
        uint256 totalFees,
        uint256 totalNet,
        uint256 timestamp
    );
    /// @notice Emitted when an individual claim succeeds
    /// @param vault Address of the vault
    /// @param account Address that received the claim
    /// @param factory Address of the factory that created the vault
    /// @param gross Gross amount claimed
    /// @param fee Fee amount deducted
    /// @param net Net amount received
    event ClaimSucceeded(
        address indexed vault,
        address indexed account,
        address indexed factory,
        uint256 gross,
        uint256 fee,
        uint256 net
    );
    /// @notice Emitted when an individual claim fails
    /// @param vault Address of the vault
    /// @param account Address that attempted to claim
    /// @param reason Reason for the failure
    event ClaimFailed(address indexed vault, address indexed account, string reason);
    /// @notice Emitted when factory approval status is updated
    /// @param factory Address of the factory
    /// @param approved New approval status
    event FactoryApprovalUpdated(address indexed factory, bool indexed approved);
    /// @notice Emitted when maximum batch size is updated
    /// @param oldSize Previous batch size limit
    /// @param newSize New batch size limit
    event MaxBatchSizeUpdated(uint256 indexed oldSize, uint256 indexed newSize);
    /// @notice Emitted when maximum gas per claim is updated
    /// @param oldGasLimit Previous maximum gas per claim
    /// @param newGasLimit New maximum gas per claim
    event MaxGasPerClaimUpdated(uint256 indexed oldGasLimit, uint256 indexed newGasLimit);
}

/**
 * @title IVaultClaim
 * @notice Interface for vault claim operations
 * @author CLONES
 */
interface IVaultClaim {
    /// @notice Pay rewards with EIP-712 signature
    /// @param account Account to pay
    /// @param cumulativeAmount Total cumulative amount due
    /// @param nonce Nonce for replay protection
    /// @param signature Publisher's EIP-712 signature
    /// @return gross Total amount claimed this transaction
    /// @return fee Platform fee deducted
    /// @return net Net amount transferred to account
    function payWithSig(
        address account,
        uint256 cumulativeAmount,
        uint256 nonce,
        bytes calldata signature
    ) external returns (uint256 gross, uint256 fee, uint256 net);

    /// @notice Get the factory address for this vault
    /// @return factory Factory contract address
    function getFactory() external view returns (address factory);
}
