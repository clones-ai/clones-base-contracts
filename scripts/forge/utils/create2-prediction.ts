import { ethers } from "ethers";

/**
 * TypeScript utilities for CREATE2 prediction and EIP-712 signature generation
 * CRITICAL: Must match Solidity implementation exactly for cross-language compatibility
 */

/**
 * Compute salt for pool creation - MUST match RewardPoolFactory._computeSalt exactly
 * @param creator Creator address
 * @param token Token address
 * @param nonce Nonce for multiple pools per creator/token pair
 * @returns Salt for CREATE2
 */
export function computeSalt(creator: string, token: string, nonce: number): string {
    // EXACT match to Solidity: keccak256(abi.encode(creator, token, nonce))
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const encoded = abiCoder.encode(
        ['address', 'address', 'uint256'],
        [creator, token, nonce]
    );
    return ethers.keccak256(encoded);
}

/**
 * Generate EIP-1167 minimal proxy init code - CRITICAL: Must match OpenZeppelin Clones.sol exactly
 * @param implementation Implementation contract address
 * @returns EIP-1167 init code
 */
export function minimalProxyInitCode(implementation: string): string {
    // EIP-1167 standard bytecode template:
    // Creation code = 0x3d602d80600a3d3981f3 + 0x363d3d373d3d3d363d73 + <impl> + 0x5af43d82803e903d91602b57fd5bf3
    const prefix1 = "0x3d602d80600a3d3981f3";
    const prefix2 = "0x363d3d373d3d3d363d73";
    const suffix = "0x5af43d82803e903d91602b57fd5bf3";

    // CRITICAL: Implementation address must be exactly 20 bytes (NOT zero-padded to 32 bytes)
    // Use zeroPadValue(impl, 20) to ensure exact 20-byte representation
    const implPadded = ethers.zeroPadValue(implementation, 20);

    return ethers.concat([prefix1, prefix2, implPadded, suffix]);
}

/**
 * Predict pool address using CREATE2 - MUST match Solidity prediction exactly
 * @param factory Factory contract address
 * @param implementation Implementation contract address
 * @param creator Creator address
 * @param token Token address
 * @param nonce Nonce for multiple pools per creator/token pair
 * @returns Predicted pool address and salt
 */
export function predictPoolAddress(
    factory: string,
    implementation: string,
    creator: string,
    token: string,
    nonce: number
): { predicted: string; salt: string } {
    const salt = computeSalt(creator, token, nonce);
    const initCodeHash = ethers.keccak256(minimalProxyInitCode(implementation));
    const predicted = ethers.getCreate2Address(factory, salt, initCodeHash);
    return { predicted, salt };
}

/**
 * EIP-712 domain for vault signatures
 */
export interface EIP712Domain {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
}

/**
 * Claim structure for EIP-712 signatures
 */
export interface ClaimStruct {
    account: string;
    cumulativeAmount: string;
    deadline: number;
}

/**
 * Generate EIP-712 signature for claim
 * @param signer Ethereum signer
 * @param vaultAddress Vault contract address
 * @param account Account to receive payment
 * @param cumulativeAmount Cumulative amount (as string to handle bigint)
 * @param deadline Signature deadline
 * @param chainId Network chain ID
 * @returns EIP-712 signature
 */
export async function signClaim(
    signer: ethers.Signer,
    vaultAddress: string,
    account: string,
    cumulativeAmount: string,
    deadline: number,
    chainId: number
): Promise<string> {
    const domain: EIP712Domain = {
        name: "FactoryVault",
        version: "1",
        chainId,
        verifyingContract: vaultAddress
    };

    const types = {
        Claim: [
            { name: "account", type: "address" },
            { name: "cumulativeAmount", type: "uint256" },
            { name: "deadline", type: "uint256" }
        ]
    };

    const value: ClaimStruct = {
        account,
        cumulativeAmount,
        deadline
    };

    return await signer.signTypedData(domain, types, value);
}

/**
 * Batch claim data structure for ClaimRouter
 */
export interface ClaimData {
    vault: string;
    account: string;
    cumulativeAmount: string;
    deadline: number;
    signature: string;
}

/**
 * Validate CREATE2 prediction against deployed contract
 * MANDATORY: End-to-end validation test to prevent production mismatches
 * @param factoryContract Factory contract instance
 * @param implementationAddress Implementation contract address
 * @param creator Creator address
 * @param token Token address
 */
export async function validatePrediction(
    factoryContract: any,
    implementationAddress: string,
    creator: string,
    token: string
): Promise<void> {
    // Get current nonce from contract
    const nonce = await factoryContract.poolNonce(creator, token);

    // TypeScript prediction using exact interface
    const { predicted: tsPredicted, salt: tsSalt } = predictPoolAddress(
        await factoryContract.getAddress(),
        implementationAddress,
        creator,
        token,
        Number(nonce)
    );

    // Solidity prediction via contract (uses current nonce internally)
    const [solidityPredicted, soliditySalt] = await factoryContract.predictPoolAddress(creator, token);

    // CRITICAL: Both predictions AND salts must match exactly
    if (tsPredicted.toLowerCase() !== solidityPredicted.toLowerCase()) {
        throw new Error(`Address mismatch: TS=${tsPredicted} vs Solidity=${solidityPredicted}`);
    }
    if (tsSalt.toLowerCase() !== soliditySalt.toLowerCase()) {
        throw new Error(`Salt mismatch: TS=${tsSalt} vs Solidity=${soliditySalt}`);
    }

    console.log(`✅ CREATE2 prediction validated: ${tsPredicted} (nonce: ${nonce})`);
}

/**
 * End-to-end validation for deployment
 * DEPLOYMENT VALIDATION: Must run this test before mainnet deployment
 * @param factoryContract Deployed factory contract
 * @param implementationAddress Implementation contract address
 */
export async function deploymentValidation(
    factoryContract: any,
    implementationAddress: string
): Promise<void> {
    console.log("🧪 Running CREATE2 deployment validation...");

    // Test multiple creator/token combinations
    const testCases = [
        {
            creator: "0x1234567890123456789012345678901234567890",
            token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" // USDC Base
        },
        {
            creator: "0x5678901234567890123456789012345678901234",
            token: "0x4200000000000000000000000000000000000006"  // WETH Base
        }
    ];

    for (const { creator, token } of testCases) {
        await validatePrediction(factoryContract, implementationAddress, creator, token);
    }

    console.log("✅ All CREATE2 predictions validated successfully");
}

/**
 * Network configurations for multi-chain deployment
 */
export const NETWORK_CONFIG = {
    baseSepolia: {
        chainId: 84532,
        rpc: "https://sepolia.base.org",
        explorer: "https://sepolia.basescan.org",
        tokens: {
            usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            weth: "0x4200000000000000000000000000000000000006",
            clones: "0x15eB86c7E54B350bf936d916Df33AEF697202E29",
        }
    },
    baseMainnet: {
        chainId: 8453,
        rpc: "https://mainnet.base.org",
        explorer: "https://basescan.org",
        tokens: {
            usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            weth: "0x4200000000000000000000000000000000000006"
        }
    }
} as const;

/**
 * Generate multiple claim signatures for batch operations
 * @param signer Publisher signer
 * @param claims Array of claim parameters
 * @param chainId Network chain ID
 * @returns Array of signed claim data
 */
export async function generateBatchClaims(
    signer: ethers.Signer,
    claims: Array<{
        vault: string;
        account: string;
        cumulativeAmount: string;
        deadline: number;
    }>,
    chainId: number
): Promise<ClaimData[]> {
    const signedClaims: ClaimData[] = [];

    for (const claim of claims) {
        const signature = await signClaim(
            signer,
            claim.vault,
            claim.account,
            claim.cumulativeAmount,
            claim.deadline,
            chainId
        );

        signedClaims.push({
            ...claim,
            signature
        });
    }

    return signedClaims;
}