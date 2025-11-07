import { ethers } from "hardhat";
import { writeRegistry } from "../utils";

/**
 * Deploy implementation contracts for EIP-1167 factory system
 * These are the master contracts that proxies will delegate to
 */
async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);

    console.log("Deploying Datamarketplace Implementation Contracts");
    console.log("Network:", network.name);
    console.log("Chain ID:", chainId);
    console.log("Deployer:", deployer.address);
    console.log("Balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)));

    // Network validation
    if (chainId !== 84532 && chainId !== 31337 && chainId !== 8453) {
        throw new Error("❌ This script supports Base Sepolia (84532), Base Mainnet (8453), or local (31337)");
    }

    const deployments: any = {
        networkName: network.name,
        chainId,
        timestamp: new Date().toISOString(),
        deployer: deployer.address,
        contracts: {}
    };

    try {
        // Step 1: Deploy DatasetTokenImplementation
        console.log("\nDeploying DatasetTokenImplementation...");
        const DatasetTokenImplFactory = await ethers.getContractFactory("DatasetTokenImplementation");
        const datasetTokenImpl = await DatasetTokenImplFactory.deploy();
        await datasetTokenImpl.waitForDeployment();
        const datasetTokenImplAddress = await datasetTokenImpl.getAddress();

        console.log("DatasetTokenImplementation deployed:", datasetTokenImplAddress);
        deployments.contracts.DatasetTokenImplementation = {
            address: datasetTokenImplAddress,
            txHash: datasetTokenImpl.deploymentTransaction()?.hash,
            args: []
        };

        // Step 2: Deploy BondingCurveImplementation
        console.log("\nDeploying BondingCurveImplementation...");
        const BondingCurveImplFactory = await ethers.getContractFactory("BondingCurveImplementation");
        const bondingCurveImpl = await BondingCurveImplFactory.deploy();
        await bondingCurveImpl.waitForDeployment();
        const bondingCurveImplAddress = await bondingCurveImpl.getAddress();

        console.log("BondingCurveImplementation deployed:", bondingCurveImplAddress);
        deployments.contracts.BondingCurveImplementation = {
            address: bondingCurveImplAddress,
            txHash: bondingCurveImpl.deploymentTransaction()?.hash,
            args: []
        };

        // Save deployment registry
        await writeRegistry(network.name, deployments);

        console.log("\nImplementation Contracts Deployment Complete!");
        console.log("Summary:");
        console.log("- DatasetTokenImplementation:", datasetTokenImplAddress);
        console.log("- BondingCurveImplementation:", bondingCurveImplAddress);
        console.log(`- Registry saved to: deployments/${network.name}.json`);

        // Verification commands
        console.log("\nVerification Commands:");
        console.log(`npx hardhat verify --network ${network.name} ${datasetTokenImplAddress}`);
        console.log(`npx hardhat verify --network ${network.name} ${bondingCurveImplAddress}`);

    } catch (error) {
        console.error("Deployment failed:", error);
        throw error;
    }
}

// Execute deployment
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});