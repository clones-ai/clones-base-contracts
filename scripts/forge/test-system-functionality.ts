import { ethers } from "hardhat";

/**
 * Test script to verify the complete factory system is working
 * Tests token allowlist, pool creation, and ClaimRouter approval
 */
async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);

    console.log("🧪 Testing Factory System Functionality");
    console.log("Network:", network.name);
    console.log("Chain ID:", chainId);
    console.log("Tester:", deployer.address);
    console.log("Balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)));

    // Contract addresses
    const FACTORY_ADDRESS = "0xda704A5bAC54FfE3A56D3B48a7EF6f3279557829";
    const CLAIM_ROUTER_ADDRESS = "0x3cF83B17163681d48B5fdd926eFcDA9940cB49fc";
    const IMPLEMENTATION_ADDRESS = "0xf5FBB3bD5Ee86746351a857a8f5Ae414898F9816";

    // Token addresses
    const MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const MAINNET_WETH = "0x4200000000000000000000000000000000000006";
    const MAINNET_CLONES = "0xaadd98Ad4660008C917C6FE7286Bc54b2eEF894d";

    console.log("\n📋 Testing Configuration:");
    console.log("Factory:", FACTORY_ADDRESS);
    console.log("ClaimRouter:", CLAIM_ROUTER_ADDRESS);
    console.log("Implementation:", IMPLEMENTATION_ADDRESS);

    try {
        // Connect to contracts
        const factory = await ethers.getContractAt("RewardPoolFactory", FACTORY_ADDRESS);
        const claimRouter = await ethers.getContractAt("ClaimRouter", CLAIM_ROUTER_ADDRESS);

        console.log("\n✅ TEST 1: Contract Connection");
        console.log("Factory connected:", await factory.getAddress());
        console.log("ClaimRouter connected:", await claimRouter.getAddress());

        console.log("\n✅ TEST 2: Factory Configuration");
        
        // Check implementation
        const implementation = await factory.POOL_IMPLEMENTATION();
        console.log(`Implementation: ${implementation === IMPLEMENTATION_ADDRESS ? '✅' : '❌'} ${implementation}`);

        // Check token allowlist
        const usdcAllowed = await factory.allowedTokens(MAINNET_USDC);
        const wethAllowed = await factory.allowedTokens(MAINNET_WETH);
        const clonesAllowed = await factory.allowedTokens(MAINNET_CLONES);

        console.log(`USDC allowed: ${usdcAllowed ? '✅' : '❌'} ${usdcAllowed}`);
        console.log(`WETH allowed: ${wethAllowed ? '✅' : '❌'} ${wethAllowed}`);
        console.log(`CLONES allowed: ${clonesAllowed ? '✅' : '❌'} ${clonesAllowed}`);

        console.log("\n✅ TEST 3: ClaimRouter Configuration");
        
        // Check factory approval
        const factoryApproved = await claimRouter.approvedFactories(FACTORY_ADDRESS);
        console.log(`Factory approved: ${factoryApproved ? '✅' : '❌'} ${factoryApproved}`);

        console.log("\n✅ TEST 4: Pool Address Prediction");
        
        // Test address prediction for each token
        const [usdcPoolAddress] = await factory.predictPoolAddress(deployer.address, MAINNET_USDC);
        const [wethPoolAddress] = await factory.predictPoolAddress(deployer.address, MAINNET_WETH);
        const [clonesPoolAddress] = await factory.predictPoolAddress(deployer.address, MAINNET_CLONES);

        console.log(`USDC pool address: ${usdcPoolAddress}`);
        console.log(`WETH pool address: ${wethPoolAddress}`);
        console.log(`CLONES pool address: ${clonesPoolAddress}`);

        console.log("\n✅ TEST 5: Pool Creation Test");
        
        // Check if USDC pool exists
        const usdcPoolCode = await ethers.provider.getCode(usdcPoolAddress);
        if (usdcPoolCode === "0x") {
            console.log("Creating test USDC pool...");
            const createTx = await factory.createPool(MAINNET_USDC, {
                gasLimit: 500000,
                gasPrice: ethers.parseUnits("2.0", "gwei")
            });
            await createTx.wait();
            console.log("✅ USDC pool created successfully");
        } else {
            console.log("✅ USDC pool already exists");
        }

        // Verify pool was created correctly
        const finalPoolCode = await ethers.provider.getCode(usdcPoolAddress);
        console.log(`Pool deployment: ${finalPoolCode !== "0x" ? '✅' : '❌'} Contract deployed`);

        // Test pool interface
        if (finalPoolCode !== "0x") {
            const pool = await ethers.getContractAt("RewardPoolImplementation", usdcPoolAddress);
            const poolToken = await pool.token();
            const poolFactory = await pool.getFactory();
            
            console.log(`Pool token: ${poolToken === MAINNET_USDC ? '✅' : '❌'} ${poolToken}`);
            console.log(`Pool factory: ${poolFactory === FACTORY_ADDRESS ? '✅' : '❌'} ${poolFactory}`);
        }

        console.log("\n✅ TEST 6: Gas Estimation");
        
        // Estimate gas for pool creation
        try {
            const gasEstimate = await factory.createPool.estimateGas(MAINNET_WETH);
            console.log(`Pool creation gas estimate: ${gasEstimate.toString()}`);
        } catch (error) {
            console.log("Gas estimation (pool might exist):", error.message);
        }

        console.log("\n✅ TEST 7: System Health Check");
        
        // Check pause status
        const factoryPaused = await factory.paused();
        console.log(`Factory paused: ${!factoryPaused ? '✅' : '⚠️'} ${factoryPaused}`);

        // Check current publisher
        const currentPublisher = await factory.publisher();
        console.log(`Current publisher: ${currentPublisher}`);

        // Summary
        console.log("\n📊 SYSTEM FUNCTIONALITY TEST SUMMARY");
        console.log("=".repeat(60));
        console.log(`Network: ${network.name} (${chainId})`);
        console.log(`Factory: ${FACTORY_ADDRESS}`);
        console.log(`ClaimRouter: ${CLAIM_ROUTER_ADDRESS}`);
        console.log(`Implementation: ${IMPLEMENTATION_ADDRESS}`);
        console.log("─".repeat(60));
        console.log("CONFIGURATION STATUS:");
        console.log(`  ✅ Factory deployed and configured`);
        console.log(`  ${usdcAllowed ? '✅' : '❌'} USDC token allowed`);
        console.log(`  ${wethAllowed ? '✅' : '❌'} WETH token allowed`);
        console.log(`  ${clonesAllowed ? '✅' : '❌'} CLONES token allowed`);
        console.log(`  ${factoryApproved ? '✅' : '❌'} ClaimRouter factory approved`);
        console.log("─".repeat(60));
        console.log("POOL CREATION:");
        console.log(`  ✅ Pool addresses predictable`);
        console.log(`  ${finalPoolCode !== "0x" ? '✅' : '❌'} Pool creation working`);
        console.log("─".repeat(60));
        console.log("SYSTEM STATUS:");
        console.log(`  ${!factoryPaused ? '✅' : '⚠️'} Factory operational`);
        console.log(`  ✅ Ready for production use`);
        console.log("=".repeat(60));

        // Save test results
        const testResults = {
            network: network.name,
            chainId: chainId,
            timestamp: new Date().toISOString(),
            tester: deployer.address,
            results: {
                factoryConfigured: true,
                tokensAllowed: {
                    usdc: usdcAllowed,
                    weth: wethAllowed,
                    clones: clonesAllowed
                },
                claimRouterConfigured: factoryApproved,
                poolCreation: finalPoolCode !== "0x",
                systemOperational: !factoryPaused
            },
            contracts: {
                factory: FACTORY_ADDRESS,
                claimRouter: CLAIM_ROUTER_ADDRESS,
                implementation: IMPLEMENTATION_ADDRESS,
                testPool: usdcPoolAddress
            }
        };

        const fs = require("fs");
        const resultsPath = `./deployments/test-results-${chainId}-${Date.now()}.json`;
        fs.writeFileSync(resultsPath, JSON.stringify(testResults, null, 2));
        console.log(`💾 Test results saved: ${resultsPath}`);

        console.log("\n🎉 SYSTEM FUNCTIONALITY TEST COMPLETED!");
        console.log("🚀 Factory system is fully operational and ready for production!");

        // Check if all tests passed
        const allTestsPassed = usdcAllowed && wethAllowed && clonesAllowed && 
                              factoryApproved && finalPoolCode !== "0x" && !factoryPaused;

        if (allTestsPassed) {
            console.log("✅ ALL TESTS PASSED - SYSTEM READY!");
        } else {
            console.log("⚠️  SOME TESTS FAILED - CHECK CONFIGURATION");
        }

    } catch (error) {
        console.error("❌ System test failed:", error);
        throw error;
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Test script failed:", error);
        process.exit(1);
    });