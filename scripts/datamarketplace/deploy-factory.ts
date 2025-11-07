import { ethers } from "hardhat";
import { readRegistry, writeRegistry } from "../utils";

/**
 * Deploy DatasetFactory - the main factory contract for EIP-1167 dataset creation
 * Requires implementations to be deployed first
 */
async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);

    console.log("Deploying DatasetFactory");
    console.log("Network:", network.name);
    console.log("Chain ID:", chainId);
    console.log("Deployer:", deployer.address);
    console.log("Balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)));

    // Network validation
    if (chainId !== 84532 && chainId !== 31337 && chainId !== 8453) {
        throw new Error("❌ This script supports Base Sepolia (84532), Base Mainnet (8453), or local (31337)");
    }

    // Token addresses and price feeds per network
    let clonesToken: string;
    let clonesUsdPriceFeed: string;
    let ethUsdPriceFeed: string;

    if (chainId === 8453) { // Base Mainnet
        clonesToken = "0xaadd98Ad4660008C917C6FE7286Bc54b2eEF894d";
        clonesUsdPriceFeed = "0x0000000000000000000000000000000000000001"; // TODO: Add actual Chainlink feed
        ethUsdPriceFeed = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70"; // ETH/USD on Base
    } else { // Base Sepolia or Local
        clonesToken = "0x15eB86c7E54B350bf936d916Df33AEF697202E29";
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
    console.log("Protocol Fee Recipient:", protocolFeeRecipient);
    console.log("Timelock:", timelockAddress);
    console.log("Guardian:", guardianAddress);
    console.log("CLONES/USD Price Feed:", clonesUsdPriceFeed);
    console.log("ETH/USD Price Feed:", ethUsdPriceFeed);
    console.log("Fallback Launch Fee:", ethers.formatEther(fallbackLaunchFee), "CLONES");

    // Read existing registry to get implementation addresses
    const deployments = await readRegistry(network.name);

    if (!deployments.contracts.DatasetTokenImplementation?.address) {
        throw new Error("DatasetTokenImplementation not found. Deploy implementations first.");
    }
    if (!deployments.contracts.BondingCurveImplementation?.address) {
        throw new Error("BondingCurveImplementation not found. Deploy implementations first.");
    }

    const datasetTokenImpl = deployments.contracts.DatasetTokenImplementation.address;
    const bondingCurveImpl = deployments.contracts.BondingCurveImplementation.address;

    console.log("\n🔗 Using Implementations:");
    console.log("DatasetTokenImplementation:", datasetTokenImpl);
    console.log("BondingCurveImplementation:", bondingCurveImpl);

    try {
        // Deploy DatasetFactory
        console.log("\nDeploying DatasetFactory...");
        const DatasetFactoryFactory = await ethers.getContractFactory("DatasetFactory");
        const datasetFactory = await DatasetFactoryFactory.deploy(
            datasetTokenImpl,
            bondingCurveImpl,
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

        console.log("✅ DatasetFactory deployed:", datasetFactoryAddress);

        // Update registry
        deployments.contracts.DatasetFactory = {
            address: datasetFactoryAddress,
            txHash: datasetFactory.deploymentTransaction()?.hash,
            args: [
                datasetTokenImpl,
                bondingCurveImpl,
                clonesToken,
                protocolFeeRecipient,
                timelockAddress,
                guardianAddress,
                clonesUsdPriceFeed,
                ethUsdPriceFeed,
                fallbackLaunchFee.toString()
            ]
        };

        deployments.timestamp = new Date().toISOString();
        await writeRegistry(network.name, deployments);

        console.log("\nDatasetFactory Deployment Complete!");
        console.log("Summary:");
        console.log("- DatasetFactory:", datasetFactoryAddress);
        console.log(`- Registry updated: deployments/${network.name}.json`);

        // Next steps
        console.log("\nNext Steps:");
        console.log("1. Update BurnPortal factory address:");
        console.log(`   burnPortal.setDatasetFactory("${datasetFactoryAddress}")`);
        console.log("2. Set GraduationManager in factory:");
        console.log(`   graduationManager.setDatasetFactory("${datasetFactoryAddress}")`);

        // Verification command
        console.log("\nVerification Command:");
        console.log(`npx hardhat verify --network ${network.name} ${datasetFactoryAddress} "${datasetTokenImpl}" "${bondingCurveImpl}" "${clonesToken}" "${protocolFeeRecipient}" "${timelockAddress}" "${guardianAddress}" "${clonesUsdPriceFeed}" "${ethUsdPriceFeed}" "${fallbackLaunchFee}"`);

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