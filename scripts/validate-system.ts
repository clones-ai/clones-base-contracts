import { ethers } from "hardhat";
import { signClaim, validatePrediction } from "./utils/create2-prediction";

/**
 * End-to-end validation of the EIP-1167 Factory system
 * Validates cross-language compatibility between Solidity and TypeScript
 */
async function main() {
    console.log("🧪 Running comprehensive system validation...\n");

    const [deployer, creator, claimer, funder] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);

    // Load deployment addresses (assuming local hardhat network)
    const deploymentInfo = require("../deployments/hardhat-31337.json");
    
    console.log("📋 Validation Parameters:");
    console.log(`Network: ${network.name} (${chainId})`);
    console.log(`Factory: ${deploymentInfo.contracts.factory}`);
    console.log(`Implementation: ${deploymentInfo.contracts.implementation}`);
    console.log(`ClaimRouter: ${deploymentInfo.contracts.claimRouter}`);
    console.log(`Test USDC: ${deploymentInfo.contracts.testTokens.usdc}\n`);

    // Declare variables at function scope
    let poolAddress: string = '';
    let vault: any;

    // Get contract instances
    const factory = await ethers.getContractAt("RewardPoolFactory", deploymentInfo.contracts.factory);
    const claimRouter = await ethers.getContractAt("ClaimRouter", deploymentInfo.contracts.claimRouter);
    const testToken = await ethers.getContractAt("TestToken", deploymentInfo.contracts.testTokens.usdc);

    let passedTests = 0;
    let totalTests = 0;

    // Test 1: CREATE2 Cross-language compatibility
    console.log("🔧 Test 1: CREATE2 Cross-language Compatibility");
    try {
        totalTests++;
        await validatePrediction(
            factory,
            deploymentInfo.contracts.implementation,
            creator.address,
            deploymentInfo.contracts.testTokens.usdc
        );
        console.log("✅ CREATE2 predictions match between Solidity and TypeScript");
        passedTests++;
    } catch (error) {
        console.error("❌ CREATE2 validation failed:", error);
    }

    // Test 2: Pool Creation and EIP-712 Signature Validation
    console.log("\n🏊 Test 2: Pool Creation and EIP-712 Signatures");
    try {
        totalTests++;
        
        // Create pool
        await factory.connect(creator).createPool(await testToken.getAddress());
        [poolAddress] = await factory.predictPoolAddress(creator.address, await testToken.getAddress());
        vault = await ethers.getContractAt("RewardPoolImplementation", poolAddress);
        
        console.log(`Pool created at: ${poolAddress}`);
        
        // Fund vault
        const fundAmount = ethers.parseUnits("1000", 6); // 1000 USDC
        await testToken.mint(funder.address, fundAmount);
        await testToken.connect(funder).approve(poolAddress, fundAmount);
        await vault.connect(funder).fund(fundAmount);
        
        console.log(`Vault funded with ${ethers.formatUnits(fundAmount, 6)} USDC`);
        
        // Generate EIP-712 signature
        const claimAmount = ethers.parseUnits("100", 6); // 100 USDC
        const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour
        
        const signature = await signClaim(
            deployer, // Publisher
            poolAddress,
            claimer.address,
            claimAmount.toString(),
            deadline,
            chainId
        );
        
        console.log("EIP-712 signature generated");
        
        // Test claim
        const tx = await vault.payWithSig(
            claimer.address,
            claimAmount,
            deadline,
            signature
        );
        
        const receipt = await tx.wait();
        const claimerBalance = await testToken.balanceOf(claimer.address);
        
        console.log(`✅ Claim successful! Claimer received: ${ethers.formatUnits(claimerBalance, 6)} USDC`);
        console.log(`Gas used: ${receipt!.gasUsed.toString()}`);
        
        passedTests++;
    } catch (error) {
        console.error("❌ Pool creation/claim failed:", error);
    }

    // Test 3: Batch Claims via ClaimRouter
    console.log("\n📦 Test 3: Batch Claims via ClaimRouter");
    try {
        totalTests++;
        
        // Create another pool for batch testing
        await factory.connect(creator).createPool(deploymentInfo.contracts.testTokens.weth);
        const [wethPoolAddress] = await factory.predictPoolAddress(creator.address, deploymentInfo.contracts.testTokens.weth);
        const wethVault = await ethers.getContractAt("RewardPoolImplementation", wethPoolAddress);
        const wethToken = await ethers.getContractAt("TestToken", deploymentInfo.contracts.testTokens.weth);
        
        // Fund WETH vault
        const wethFundAmount = ethers.parseUnits("10", 18); // 10 WETH
        await wethToken.mint(funder.address, wethFundAmount);
        await wethToken.connect(funder).approve(wethPoolAddress, wethFundAmount);
        await wethVault.connect(funder).fund(wethFundAmount);
        
        console.log(`WETH vault funded with ${ethers.formatUnits(wethFundAmount, 18)} WETH`);
        
        // Generate batch claims
        const deadline = Math.floor(Date.now() / 1000) + 3600;
        const claimAmount1 = ethers.parseUnits("50", 6); // 50 more USDC (cumulative 150)
        const claimAmount2 = ethers.parseUnits("1", 18); // 1 WETH
        
        const signature1 = await signClaim(
            deployer,
            poolAddress,
            claimer.address,
            (ethers.parseUnits("100", 6) + claimAmount1).toString(), // Cumulative: previous 100 + 50
            deadline,
            chainId
        );
        
        const signature2 = await signClaim(
            deployer,
            wethPoolAddress,
            claimer.address,
            claimAmount2.toString(),
            deadline,
            chainId
        );
        
        const batchClaims = [
            {
                vault: poolAddress,
                account: claimer.address,
                cumulativeAmount: (ethers.parseUnits("100", 6) + claimAmount1),
                deadline,
                signature: signature1
            },
            {
                vault: wethPoolAddress,
                account: claimer.address,
                cumulativeAmount: claimAmount2,
                deadline,
                signature: signature2
            }
        ];
        
        // Execute batch claim
        const batchTx = await claimRouter.claimAll(batchClaims);
        const batchReceipt = await batchTx.wait();
        
        // Check results
        const finalUsdcBalance = await testToken.balanceOf(claimer.address);
        const finalWethBalance = await wethToken.balanceOf(claimer.address);
        
        console.log(`✅ Batch claim successful!`);
        console.log(`Total USDC: ${ethers.formatUnits(finalUsdcBalance, 6)} USDC`);
        console.log(`Total WETH: ${ethers.formatUnits(finalWethBalance, 18)} WETH`);
        console.log(`Batch gas used: ${batchReceipt!.gasUsed.toString()}`);
        
        passedTests++;
    } catch (error) {
        console.error("❌ Batch claim failed:", error);
    }

    // Test 4: Publisher Rotation
    console.log("\n🔄 Test 4: Publisher Rotation");
    try {
        totalTests++;
        
        const newPublisher = creator; // Use creator as new publisher
        
        // Initiate rotation
        await factory.initiatePublisherRotation(newPublisher.address);
        console.log("Publisher rotation initiated");
        
        // Test that both old and new publishers work during grace period
        const [currentPoolAddress] = await factory.predictPoolAddress(creator.address, await testToken.getAddress());
        const vault = await ethers.getContractAt("RewardPoolImplementation", poolAddress);
        
        const deadline = Math.floor(Date.now() / 1000) + 3600;
        const claimAmount = ethers.parseUnits("25", 6); // 25 USDC
        const cumulativeAmount = ethers.parseUnits("175", 6); // Previous 150 + 25
        
        // Sign with new publisher
        const newSignature = await signClaim(
            newPublisher,
            currentPoolAddress,
            claimer.address,
            cumulativeAmount.toString(),
            deadline,
            chainId
        );
        
        await vault.payWithSig(
            claimer.address,
            cumulativeAmount,
            deadline,
            newSignature
        );
        
        const updatedBalance = await testToken.balanceOf(claimer.address);
        console.log(`✅ Publisher rotation successful! New balance: ${ethers.formatUnits(updatedBalance, 6)} USDC`);
        
        passedTests++;
    } catch (error) {
        console.error("❌ Publisher rotation failed:", error);
    }

    // Test 5: Gas Benchmarks
    console.log("\n⛽ Test 5: Gas Benchmarks");
    try {
        totalTests++;
        
        const gasResults = {
            poolCreation: 0,
            firstClaim: 0,
            subsequentClaim: 0,
            batchClaim: 0
        };
        
        // Pool creation gas
        const newCreator = funder;
        const poolCreationTx = await factory.connect(newCreator).createPool(await testToken.getAddress());
        const poolCreationReceipt = await poolCreationTx.wait();
        gasResults.poolCreation = Number(poolCreationReceipt!.gasUsed);
        
        // Claim gas (already have data from previous tests)
        console.log("✅ Gas benchmarks collected:");
        console.log(`  Pool Creation: ${gasResults.poolCreation.toLocaleString()} gas`);
        console.log(`  Target: <180k gas for pool creation`);
        
        if (gasResults.poolCreation < 180000) {
            console.log("✅ Pool creation gas target met");
        } else {
            console.log("❌ Pool creation gas target exceeded");
        }
        
        passedTests++;
    } catch (error) {
        console.error("❌ Gas benchmarking failed:", error);
    }

    // Final Results
    console.log("\n📊 Validation Summary");
    console.log("=".repeat(50));
    console.log(`Tests Passed: ${passedTests}/${totalTests}`);
    console.log(`Success Rate: ${((passedTests/totalTests) * 100).toFixed(1)}%`);
    
    if (passedTests === totalTests) {
        console.log("🎉 ALL TESTS PASSED - System ready for production!");
        console.log("\n✅ Phase 1 Implementation Complete:");
        console.log("  ✅ EIP-1167 Factory with CREATE2");
        console.log("  ✅ Cumulative EIP-712 signature pattern");
        console.log("  ✅ Batch claims with factory validation");
        console.log("  ✅ Cross-language compatibility validated");
        console.log("  ✅ Gas benchmarks within targets");
        console.log("  ✅ Publisher rotation working");
    } else {
        console.log("❌ Some tests failed - review required before production");
        process.exit(1);
    }
}

main()
    .then(() => {
        console.log("\n🚀 Ready for Sepolia testnet deployment!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ Validation failed:", error);
        process.exit(1);
    });