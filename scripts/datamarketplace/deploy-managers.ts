import { ethers } from "hardhat";
import { readRegistry, writeRegistry } from "../utils";

/**
 * Deploy management contracts (GraduationManager and BurnPortal)
 * These handle the lifecycle management of datasets
 */
async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);

    console.log("Deploying Datamarketplace Management Contracts");
    console.log("Network:", network.name);
    console.log("Chain ID:", chainId);
    console.log("Deployer:", deployer.address);
    console.log("Balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)));

    // Network validation
    if (chainId !== 84532 && chainId !== 31337 && chainId !== 8453) {
        throw new Error("This script supports Base Sepolia (84532), Base Mainnet (8453), or local (31337)");
    }

    // Base network addresses
    let uniswapV2Factory: string;
    let uniswapV2Router: string;
    let weth: string;

    if (chainId === 8453) { // Base Mainnet
        uniswapV2Factory = "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6"; // Uniswap V2 Factory on Base
        uniswapV2Router = "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24";  // Uniswap V2 Router on Base
        weth = "0x4200000000000000000000000000000000000006"; // WETH on Base
    } else { // Base Sepolia or Local
        // Use mock addresses for testnet
        uniswapV2Factory = "0x4200000000000000000000000000000000000006";
        uniswapV2Router = "0x4200000000000000000000000000000000000006";
        weth = "0x4200000000000000000000000000000000000006";
    }

    // Deploy parameters - read from environment or use deployer as fallback
    const timelockAddress = process.env.TIMELOCK_ADDRESS || deployer.address;
    const guardianAddress = process.env.GUARDIAN_ADDRESS || deployer.address;

    console.log("\nDeployment Parameters:");
    console.log("Uniswap V2 Factory:", uniswapV2Factory);
    console.log("Uniswap V2 Router:", uniswapV2Router);
    console.log("WETH:", weth);
    console.log("Timelock:", timelockAddress);
    console.log("Guardian:", guardianAddress);

    // Read existing registry
    let deployments = await readRegistry(network.name);

    try {
        // Step 1: Deploy GraduationManager
        console.log("\nDeploying GraduationManager...");
        const GraduationManagerFactory = await ethers.getContractFactory("GraduationManager");
        const graduationManager = await GraduationManagerFactory.deploy(
            uniswapV2Factory,
            uniswapV2Router,
            weth,
            timelockAddress,
            guardianAddress
        );
        await graduationManager.waitForDeployment();
        const graduationManagerAddress = await graduationManager.getAddress();

        console.log("GraduationManager deployed:", graduationManagerAddress);
        deployments.contracts.GraduationManager = {
            address: graduationManagerAddress,
            txHash: graduationManager.deploymentTransaction()?.hash,
            args: [uniswapV2Factory, uniswapV2Router, weth, timelockAddress, guardianAddress]
        };

        // Step 2: Deploy BurnPortal
        console.log("\nDeploying BurnPortal...");
        const BurnPortalFactory = await ethers.getContractFactory("BurnPortal");
        const burnPortal = await BurnPortalFactory.deploy(
            ethers.ZeroAddress, // datasetFactory (will be set later)
            graduationManagerAddress
        );
        await burnPortal.waitForDeployment();
        const burnPortalAddress = await burnPortal.getAddress();

        console.log("BurnPortal deployed:", burnPortalAddress);
        deployments.contracts.BurnPortal = {
            address: burnPortalAddress,
            txHash: burnPortal.deploymentTransaction()?.hash,
            args: [ethers.ZeroAddress, graduationManagerAddress]
        };

        // Update deployment registry
        deployments.timestamp = new Date().toISOString();
        await writeRegistry(network.name, deployments);

        console.log("\nManagement Contracts Deployment Complete!");
        console.log("Summary:");
        console.log("- GraduationManager:", graduationManagerAddress);
        console.log("- BurnPortal:", burnPortalAddress);
        console.log(`- Registry updated: deployments/${network.name}.json`);

        // Verification commands
        console.log("\nVerification Commands:");
        console.log(`npx hardhat verify --network ${network.name} ${graduationManagerAddress} "${uniswapV2Factory}" "${uniswapV2Router}" "${weth}" "${timelockAddress}" "${guardianAddress}"`);
        console.log(`npx hardhat verify --network ${network.name} ${burnPortalAddress} "${ethers.ZeroAddress}" "${graduationManagerAddress}"`);

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