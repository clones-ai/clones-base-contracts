import { ethers, run } from "hardhat";
import { readRegistry } from "../utils";

/**
 * Verify all datamarketplace contracts on block explorer
 * Reads deployment registry and verifies contracts with correct constructor args
 */
async function main() {
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);

    console.log("Verifying Datamarketplace Contracts");
    console.log("Network:", network.name);
    console.log("Chain ID:", chainId);

    // Network validation
    if (chainId !== 84532 && chainId !== 8453) {
        throw new Error("Verification only supports Base Sepolia (84532) or Base Mainnet (8453)");
    }

    // Read deployment registry
    const deployments = await readRegistry(network.name);
    if (!deployments.contracts) {
        throw new Error("No deployments found. Deploy contracts first.");
    }

    const contracts = deployments.contracts;

    console.log("\nContracts to verify:");
    for (const [name, contract] of Object.entries(contracts)) {
        console.log(`- ${name}: ${(contract as any).address}`);
    }

    try {
        // Verify DatasetTokenImplementation
        if (contracts.DatasetTokenImplementation) {
            console.log("\nVerifying DatasetTokenImplementation...");
            try {
                await run("verify:verify", {
                    address: contracts.DatasetTokenImplementation.address,
                    constructorArguments: contracts.DatasetTokenImplementation.args || []
                });
                console.log("DatasetTokenImplementation verified");
            } catch (error: any) {
                if (error.message.includes("Already Verified")) {
                    console.log("DatasetTokenImplementation already verified");
                } else {
                    console.error("DatasetTokenImplementation verification failed:", error.message);
                }
            }
        }

        // Verify BondingCurveImplementation
        if (contracts.BondingCurveImplementation) {
            console.log("\nVerifying BondingCurveImplementation...");
            try {
                await run("verify:verify", {
                    address: contracts.BondingCurveImplementation.address,
                    constructorArguments: contracts.BondingCurveImplementation.args || []
                });
                console.log("BondingCurveImplementation verified");
            } catch (error: any) {
                if (error.message.includes("Already Verified")) {
                    console.log("BondingCurveImplementation already verified");
                } else {
                    console.error("BondingCurveImplementation verification failed:", error.message);
                }
            }
        }

        // Verify GraduationManager
        if (contracts.GraduationManager) {
            console.log("\nVerifying GraduationManager...");
            try {
                await run("verify:verify", {
                    address: contracts.GraduationManager.address,
                    constructorArguments: contracts.GraduationManager.args || []
                });
                console.log("GraduationManager verified");
            } catch (error: any) {
                if (error.message.includes("Already Verified")) {
                    console.log("GraduationManager already verified");
                } else {
                    console.error("GraduationManager verification failed:", error.message);
                }
            }
        }

        // Verify BurnPortal
        if (contracts.BurnPortal) {
            console.log("\nVerifying BurnPortal...");
            try {
                await run("verify:verify", {
                    address: contracts.BurnPortal.address,
                    constructorArguments: contracts.BurnPortal.args || []
                });
                console.log("BurnPortal verified");
            } catch (error: any) {
                if (error.message.includes("Already Verified")) {
                    console.log("BurnPortal already verified");
                } else {
                    console.error("BurnPortal verification failed:", error.message);
                }
            }
        }

        // Verify DatasetFactory
        if (contracts.DatasetFactory) {
            console.log("\nVerifying DatasetFactory...");
            try {
                await run("verify:verify", {
                    address: contracts.DatasetFactory.address,
                    constructorArguments: contracts.DatasetFactory.args || []
                });
                console.log("DatasetFactory verified");
            } catch (error: any) {
                if (error.message.includes("Already Verified")) {
                    console.log("DatasetFactory already verified");
                } else {
                    console.error("DatasetFactory verification failed:", error.message);
                }
            }
        }

        console.log("\nContract verification completed!");

        // Print block explorer links
        const explorerBase = chainId === 8453
            ? "https://basescan.org/address/"
            : "https://sepolia.basescan.org/address/";

        console.log("\nBlock Explorer Links:");
        for (const [name, contract] of Object.entries(contracts)) {
            console.log(`- ${name}: ${explorerBase}${(contract as any).address}`);
        }

    } catch (error) {
        console.error("Verification process failed:", error);
        throw error;
    }
}

// Execute verification
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});