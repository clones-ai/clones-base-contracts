import { ethers } from "hardhat";
import { writeRegistry } from "../utils";

/**
 * Complete datamarketplace deployment orchestration script
 * Deploys all contracts in correct order and sets up the system
 */
async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);

    console.log("Complete Datamarketplace System Deployment");
    console.log("Network:", network.name);
    console.log("Chain ID:", chainId);
    console.log("Deployer:", deployer.address);
    console.log("Balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)));

    // Network validation
    if (chainId !== 84532 && chainId !== 31337 && chainId !== 8453) {
        throw new Error("This script supports Base Sepolia (84532), Base Mainnet (8453), or local (31337)");
    }

    // Network-specific addresses
    let clonesToken: string;
    let uniswapV2Factory: string;
    let uniswapV2Router: string;
    let weth: string;
    let clonesUsdPriceFeed: string;
    let ethUsdPriceFeed: string;

    if (chainId === 8453) { // Base Mainnet
        clonesToken = "0xaadd98Ad4660008C917C6FE7286Bc54b2eEF894d";
        uniswapV2Factory = "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6";
        uniswapV2Router = "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24";
        weth = "0x4200000000000000000000000000000000000006";
        // Chainlink price feeds on Base Mainnet
        clonesUsdPriceFeed = "0x0000000000000000000000000000000000000001"; // TODO: Add actual Chainlink feed
        ethUsdPriceFeed = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70"; // ETH/USD on Base
    } else { // Base Sepolia or Local
        clonesToken = "0x15eB86c7E54B350bf936d916Df33AEF697202E29";
        uniswapV2Factory = "0x4200000000000000000000000000000000000006"; // Mock
        uniswapV2Router = "0x4200000000000000000000000000000000000006"; // Mock
        weth = "0x4200000000000000000000000000000000000006";
        // Mock price feeds for testnet
        clonesUsdPriceFeed = "0x0000000000000000000000000000000000000001"; // Mock
        ethUsdPriceFeed = "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1"; // ETH/USD on Base Sepolia
    }

    // Deploy parameters
    const protocolFeeRecipient = process.env.PROTOCOL_FEE_RECIPIENT || deployer.address;
    const timelockAddress = process.env.TIMELOCK_ADDRESS || deployer.address;
    const guardianAddress = process.env.GUARDIAN_ADDRESS || deployer.address;
    const fallbackLaunchFee = ethers.parseEther("100"); // 100 CLONES (~$50) fallback if oracle fails

    console.log("\nDeployment Parameters:");
    console.log("CLONES Token:", clonesToken);
    console.log("Uniswap V2 Factory:", uniswapV2Factory);
    console.log("Uniswap V2 Router:", uniswapV2Router);
    console.log("WETH:", weth);
    console.log("Protocol Fee Recipient:", protocolFeeRecipient);
    console.log("Timelock:", timelockAddress);
    console.log("Guardian:", guardianAddress);

    const deployments: any = {
        networkName: network.name,
        chainId,
        timestamp: new Date().toISOString(),
        deployer: deployer.address,
        contracts: {}
    };

    try {
        // Phase 1: Deploy Implementation Contracts
        console.log("\nPhase 1: Deploying Implementation Contracts");

        console.log("\nDeploying DatasetTokenImplementation...");
        const DatasetTokenImplFactory = await ethers.getContractFactory("DatasetTokenImplementation");
        const datasetTokenImpl = await DatasetTokenImplFactory.deploy();
        await datasetTokenImpl.waitForDeployment();
        const datasetTokenImplAddress = await datasetTokenImpl.getAddress();
        console.log("DatasetTokenImplementation:", datasetTokenImplAddress);

        deployments.contracts.DatasetTokenImplementation = {
            address: datasetTokenImplAddress,
            txHash: datasetTokenImpl.deploymentTransaction()?.hash,
            args: []
        };

        console.log("\nDeploying BondingCurveImplementation...");
        const BondingCurveImplFactory = await ethers.getContractFactory("BondingCurveImplementation");
        const bondingCurveImpl = await BondingCurveImplFactory.deploy();
        await bondingCurveImpl.waitForDeployment();
        const bondingCurveImplAddress = await bondingCurveImpl.getAddress();
        console.log("BondingCurveImplementation:", bondingCurveImplAddress);

        deployments.contracts.BondingCurveImplementation = {
            address: bondingCurveImplAddress,
            txHash: bondingCurveImpl.deploymentTransaction()?.hash,
            args: []
        };

        // Phase 2: Deploy Management Contracts
        console.log("\nPhase 2: Deploying Management Contracts");

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
        console.log("GraduationManager:", graduationManagerAddress);

        deployments.contracts.GraduationManager = {
            address: graduationManagerAddress,
            txHash: graduationManager.deploymentTransaction()?.hash,
            args: [uniswapV2Factory, uniswapV2Router, weth, timelockAddress, guardianAddress]
        };

        console.log("\nDeploying BurnPortal...");
        const BurnPortalFactory = await ethers.getContractFactory("BurnPortal");
        const burnPortal = await BurnPortalFactory.deploy(
            timelockAddress, // timelock
            guardianAddress  // guardian
        );
        await burnPortal.waitForDeployment();
        const burnPortalAddress = await burnPortal.getAddress();
        console.log("BurnPortal:", burnPortalAddress);

        deployments.contracts.BurnPortal = {
            address: burnPortalAddress,
            txHash: burnPortal.deploymentTransaction()?.hash,
            args: [timelockAddress, guardianAddress]
        };

        // Phase 3: Deploy Factory
        console.log("\nPhase 3: Deploying DatasetFactory");

        const DatasetFactoryFactory = await ethers.getContractFactory("DatasetFactory");
        const datasetFactory = await DatasetFactoryFactory.deploy(
            datasetTokenImplAddress,
            bondingCurveImplAddress,
            clonesToken,
            protocolFeeRecipient,
            timelockAddress,
            guardianAddress,
            clonesUsdPriceFeed,
            ethUsdPriceFeed,
            fallbackLaunchFee
        );
        await datasetFactory.waitForDeployment();
        const datasetFactoryAddress = await datasetFactory.getAddress();
        console.log("DatasetFactory:", datasetFactoryAddress);

        deployments.contracts.DatasetFactory = {
            address: datasetFactoryAddress,
            txHash: datasetFactory.deploymentTransaction()?.hash,
            args: [
                datasetTokenImplAddress,
                bondingCurveImplAddress,
                clonesToken,
                protocolFeeRecipient,
                timelockAddress,
                guardianAddress,
                clonesUsdPriceFeed,
                ethUsdPriceFeed,
                fallbackLaunchFee.toString()
            ]
        };

        // Phase 4: System Configuration
        console.log("\nPhase 4: System Configuration");

        console.log("\nSetting DatasetFactory in BurnPortal...");
        await burnPortal.setDatasetFactory(datasetFactoryAddress);
        console.log("BurnPortal configured with DatasetFactory");

        console.log("\nSetting DatasetFactory in GraduationManager...");
        await graduationManager.setDatasetFactory(datasetFactoryAddress);
        console.log("GraduationManager configured with DatasetFactory");

        console.log("\nSetting GraduationManager in BurnPortal...");
        await burnPortal.setGraduationManager(graduationManagerAddress);
        console.log("BurnPortal configured with GraduationManager");

        console.log("\nSetting BurnPortal in GraduationManager...");
        await graduationManager.setBurnPortal(burnPortalAddress);
        console.log("GraduationManager configured with BurnPortal");

        // CRITICAL: Configure DatasetFactory with managers (required for dataset creation)
        console.log("\nConfiguring DatasetFactory with managers...");
        await datasetFactory.setGraduationManager(graduationManagerAddress);
        console.log("DatasetFactory configured with GraduationManager");
        
        await datasetFactory.setBurnPortal(burnPortalAddress);
        console.log("DatasetFactory configured with BurnPortal");
        
        // Verify factory is ready for dataset creation
        const isReady = await datasetFactory.isReadyForDatasetCreation();
        console.log("DatasetFactory ready for dataset creation:", isReady);
        if (!isReady) {
            throw new Error("DatasetFactory not ready for dataset creation!");
        }

        // Save deployment registry
        deployments.timestamp = new Date().toISOString();
        deployments.configured = true;
        await writeRegistry(network.name, deployments);

        console.log("\nComplete Datamarketplace System Deployment Successful!");
        console.log("\nSummary:");
        console.log("- DatasetTokenImplementation:", datasetTokenImplAddress);
        console.log("- BondingCurveImplementation:", bondingCurveImplAddress);
        console.log("- GraduationManager:", graduationManagerAddress);
        console.log("- BurnPortal:", burnPortalAddress);
        console.log("- DatasetFactory:", datasetFactoryAddress);
        console.log(`- Registry saved to: deployments/${network.name}.json`);

        // Verification commands
        console.log("\nVerification Commands:");
        console.log(`npx hardhat verify --network ${network.name} ${datasetTokenImplAddress}`);
        console.log(`npx hardhat verify --network ${network.name} ${bondingCurveImplAddress}`);
        console.log(`npx hardhat verify --network ${network.name} ${graduationManagerAddress} "${uniswapV2Factory}" "${uniswapV2Router}" "${weth}" "${timelockAddress}" "${guardianAddress}"`);
        console.log(`npx hardhat verify --network ${network.name} ${burnPortalAddress} "${timelockAddress}" "${guardianAddress}"`);
        console.log(`npx hardhat verify --network ${network.name} ${datasetFactoryAddress} "${datasetTokenImplAddress}" "${bondingCurveImplAddress}" "${clonesToken}" "${protocolFeeRecipient}" "${timelockAddress}" "${guardianAddress}" "${clonesUsdPriceFeed}" "${ethUsdPriceFeed}" "${fallbackLaunchFee}"`);

        // System ready message
        console.log("\nSystem is ready for dataset creation!");
        console.log("Users can now call datasetFactory.createDataset() to deploy datasets");

    } catch (error) {
        console.error("Deployment failed:", error);
        await writeRegistry(network.name, deployments); // Save partial progress
        throw error;
    }
}

// Execute deployment
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});