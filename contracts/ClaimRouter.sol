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
    /// @notice Registry of trusted factory addresses
    mapping(address => bool) public approvedFactories; // Registry of trusted factories

    // ----------- Structs ----------- //
    struct ClaimData {
        address vault;
        address account; // Account to pay (verified in signature)
        uint256 cumulativeAmount; // Cumulative pattern
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

        // Process claims for valid vaults only
        for (uint256 i = 0; i < claimsLength; ) {
            if (vaultFactories[i] == address(0)) {
                unchecked {
                    ++i;
                }
                continue;
            }

            try
                IVaultClaim(claims[i].vault).payWithSig(
                    claims[i].account,
                    claims[i].cumulativeAmount,
                    claims[i].signature
                )
            returns (uint256 gross, uint256 fee, uint256 net) {
                ++successful;
                totalGross += gross;
                totalFees += fee;
                totalNet += net;
                emit ClaimSucceeded(claims[i].vault, claims[i].account, vaultFactories[i], gross, fee, net);
            } catch Error(string memory reason) {
                ++failed;
                emit ClaimFailed(claims[i].vault, claims[i].account, reason);
            } catch {
                ++failed;
                emit ClaimFailed(claims[i].vault, claims[i].account, "Low-level failure");
            }
            unchecked {
                ++i;
            }
        }

        emit BatchClaimed(msg.sender, successful, failed, totalGross, totalFees, totalNet, block.timestamp);
    }

    // ----------- View Functions ----------- //
    /// @notice Get timelock address
    /// @return Timelock address
    function timelock() external view returns (address) {
        return TIMELOCK;
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
    /// @param signature Publisher's EIP-712 signature
    /// @return gross Total amount claimed this transaction
    /// @return fee Platform fee deducted
    /// @return net Net amount transferred to account
    function payWithSig(
        address account,
        uint256 cumulativeAmount,
        bytes calldata signature
    ) external returns (uint256 gross, uint256 fee, uint256 net);

    /// @notice Get the factory address for this vault
    /// @return factory Factory contract address
    function getFactory() external view returns (address factory);
}
