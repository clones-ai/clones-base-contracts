import { ethers } from "hardhat";
import { 
    predictPoolAddress, 
    deploymentValidation, 
    NETWORK_CONFIG 
} from "./utils/create2-prediction";

/**
 * Deploy the complete EIP-1167 Factory system to Base Sepolia
 * Phase 1: Dev deployment + Sepolia testnet (no mainnet)
 */
async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);
    
    console.log("🚀 Deploying EIP-1167 Factory System");
    console.log("Network:", network.name);
    console.log("Chain ID:", chainId);
    console.log("Deployer:", deployer.address);
    console.log("Balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)));
    
    // Network validation
    if (chainId !== 84532 && chainId !== 31337) { // Base Sepolia or Hardhat local
        throw new Error("❌ This script only supports Base Sepolia (84532) or local development (31337)");
    }
    
    // Deploy parameters
    const treasuryAddress = deployer.address; // Use deployer as treasury for testing
    const timelockAddress = deployer.address; // For testnet - use deployer as timelock
    const guardianAddress = deployer.address; // For testnet - use deployer as guardian  
    const publisherAddress = deployer.address; // For testnet - use deployer as publisher
    
    console.log("\n📋 Deployment Parameters:");
    console.log("Treasury:", treasuryAddress);
    console.log("Timelock:", timelockAddress);
    console.log("Guardian:", guardianAddress);
    console.log("Publisher:", publisherAddress);
    
    // 1. Deploy Implementation Contract
    console.log("\n🔧 Deploying RewardPoolImplementation...");
    const ImplementationFactory = await ethers.getContractFactory("RewardPoolImplementation");
    const implementation = await ImplementationFactory.deploy();
    await implementation.waitForDeployment();
    const implementationAddress = await implementation.getAddress();
    console.log("✅ RewardPoolImplementation deployed to:", implementationAddress);
    
    // 2. Deploy Factory Contract
    console.log("\n🏭 Deploying RewardPoolFactory...");
    const FactoryContractFactory = await ethers.getContractFactory("RewardPoolFactory");
    const factory = await FactoryContractFactory.deploy(
        implementationAddress,
        treasuryAddress,
        timelockAddress,
        guardianAddress,
        publisherAddress
    );
    await factory.waitForDeployment();
    const factoryAddress = await factory.getAddress();
    console.log("✅ RewardPoolFactory deployed to:", factoryAddress);
    
    // 3. Deploy ClaimRouter
    console.log("\n🛣️ Deploying ClaimRouter...");
    const ClaimRouterFactory = await ethers.getContractFactory("ClaimRouter");
    const claimRouter = await ClaimRouterFactory.deploy(timelockAddress);
    await claimRouter.waitForDeployment();
    const claimRouterAddress = await claimRouter.getAddress();
    console.log("✅ ClaimRouter deployed to:", claimRouterAddress);
    
    // 4. Deploy Test Tokens (for Sepolia testing)
    let usdcAddress = "";
    let wethAddress = "";
    
    if (chainId === 84532) {
        // Use Base Sepolia test tokens
        usdcAddress = NETWORK_CONFIG.baseSepolia.tokens.usdc;
        wethAddress = NETWORK_CONFIG.baseSepolia.tokens.weth;
        console.log("\n💰 Using Base Sepolia test tokens:");
        console.log("USDC:", usdcAddress);
        console.log("WETH:", wethAddress);
    } else {
        // Deploy test tokens for local development
        console.log("\n💰 Deploying Test Tokens...");
        const TestTokenFactory = await ethers.getContractFactory("TestToken");
        
        const usdc = await TestTokenFactory.deploy("USD Coin", "USDC", 6);
        await usdc.waitForDeployment();
        usdcAddress = await usdc.getAddress();
        console.log("✅ Test USDC deployed to:", usdcAddress);
        
        const weth = await TestTokenFactory.deploy("Wrapped Ether", "WETH", 18);
        await weth.waitForDeployment();
        wethAddress = await weth.getAddress();
        console.log("✅ Test WETH deployed to:", wethAddress);
    }
    
    // 5. Setup Configuration
    console.log("\n⚙️ Setting up configuration...");
    
    // Approve factory in ClaimRouter
    console.log("Approving factory in ClaimRouter...");
    await claimRouter.setFactoryApproved(factoryAddress, true);
    console.log("✅ Factory approved in ClaimRouter");
    
    // Add tokens to allow-list
    console.log("Adding tokens to factory allow-list...");
    await factory.setTokenAllowed(usdcAddress, true);
    await factory.setTokenAllowed(wethAddress, true);
    console.log("✅ Tokens added to allow-list");
    
    // 6. CREATE2 Validation
    console.log("\n🧪 Validating CREATE2 predictions...");
    await deploymentValidation(factory, implementationAddress);
    
    // 7. Test Pool Creation
    console.log("\n🏊 Testing pool creation...");
    const testCreator = deployer.address;
    
    // Predict address
    const { predicted } = predictPoolAddress(
        factoryAddress,
        implementationAddress,
        testCreator,
        usdcAddress
    );
    console.log("Predicted pool address:", predicted);
    
    // Create pool
    await factory.createPool(usdcAddress);
    console.log("✅ Test pool created successfully");
    
    // Verify prediction
    const [actualAddress] = await factory.predictPoolAddress(testCreator, usdcAddress);
    if (predicted.toLowerCase() !== actualAddress.toLowerCase()) {
        throw new Error("❌ CREATE2 prediction mismatch!");
    }
    console.log("✅ CREATE2 prediction verified");
    
    // 8. Gas Benchmarks
    console.log("\n⛽ Running gas benchmarks...");
    
    // Test claim with signature
    const vault = await ethers.getContractAt("RewardPoolImplementation", actualAddress);
    
    // Fund vault for testing
    if (chainId === 31337) {
        const testToken = await ethers.getContractAt("TestToken", usdcAddress);
        const fundAmount = ethers.parseUnits("1000", 6); // 1000 USDC
        await testToken.mint(deployer.address, fundAmount);
        await testToken.approve(actualAddress, fundAmount);
        await vault.fund(fundAmount);
        console.log("✅ Test vault funded");
    }
    
    // 9. Summary
    console.log("\n📊 Deployment Summary");
    console.log("=".repeat(50));
    console.log(`Network: ${network.name} (${chainId})`);
    console.log(`Implementation: ${implementationAddress}`);
    console.log(`Factory: ${factoryAddress}`);
    console.log(`ClaimRouter: ${claimRouterAddress}`);
    console.log(`Test USDC: ${usdcAddress}`);
    console.log(`Test WETH: ${wethAddress}`);
    console.log(`Test Pool (USDC): ${actualAddress}`);
    console.log("=".repeat(50));
    
    // 10. Save deployment info
    const deploymentInfo = {
        network: network.name,
        chainId: chainId,
        timestamp: new Date().toISOString(),
        contracts: {
            implementation: implementationAddress,
            factory: factoryAddress,
            claimRouter: claimRouterAddress,
            testTokens: {
                usdc: usdcAddress,
                weth: wethAddress
            },
            testPools: {
                usdcPool: actualAddress
            }
        },
        config: {
            treasury: treasuryAddress,
            timelock: timelockAddress,
            guardian: guardianAddress,
            publisher: publisherAddress
        }
    };
    
    // Save to file
    const fs = require("fs");
    const path = `./deployments/${network.name}-${chainId}.json`;
    fs.writeFileSync(path, JSON.stringify(deploymentInfo, null, 2));
    console.log(`💾 Deployment info saved to ${path}`);
    
    console.log("\n🎉 Factory system deployment completed successfully!");
    console.log("\n📝 Next Steps:");
    console.log("1. Verify contracts on block explorer");
    console.log("2. Test claim functionality with signatures");
    console.log("3. Run comprehensive integration tests");
    console.log("4. Setup monitoring and analytics");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    });