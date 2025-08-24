import { ethers } from "hardhat";

/**
 * Deploy system and run comprehensive tests
 */
async function main() {
    console.log("🚀 Deploy and Test EIP-1167 Factory System\n");

    const [deployer, creator, claimer] = await ethers.getSigners();
    
    // 1. DEPLOYMENT
    console.log("1️⃣ DEPLOYMENT PHASE");
    console.log("=".repeat(30));
    
    // Deploy Implementation
    const ImplFactory = await ethers.getContractFactory("RewardPoolImplementation");
    const implementation = await ImplFactory.deploy();
    await implementation.waitForDeployment();
    console.log(`✅ Implementation: ${await implementation.getAddress()}`);

    // Deploy Factory
    const FactoryFactory = await ethers.getContractFactory("RewardPoolFactory");
    const factory = await FactoryFactory.deploy(
        await implementation.getAddress(),
        deployer.address, // treasury
        deployer.address, // timelock
        deployer.address, // guardian
        deployer.address  // publisher
    );
    await factory.waitForDeployment();
    console.log(`✅ Factory: ${await factory.getAddress()}`);

    // Deploy ClaimRouter
    const RouterFactory = await ethers.getContractFactory("ClaimRouter");
    const claimRouter = await RouterFactory.deploy(deployer.address);
    await claimRouter.waitForDeployment();
    console.log(`✅ ClaimRouter: ${await claimRouter.getAddress()}`);

    // Deploy Test Token
    const TestTokenFactory = await ethers.getContractFactory("TestToken");
    const testToken = await TestTokenFactory.deploy("Test USDC", "USDC", 6);
    await testToken.waitForDeployment();
    console.log(`✅ Test Token: ${await testToken.getAddress()}`);

    // Configuration
    await claimRouter.setFactoryApproved(await factory.getAddress(), true);
    await factory.setTokenAllowed(await testToken.getAddress(), true);
    console.log("✅ System configured");

    // 2. TESTING PHASE
    console.log("\n2️⃣ TESTING PHASE");
    console.log("=".repeat(30));
    
    try {
        // Test 1: Pool Creation
        console.log("🏊 Creating pool...");
        const poolExists = await factory.poolExists(creator.address, await testToken.getAddress());
        console.log(`Pool exists: ${poolExists}`);
        
        if (!poolExists) {
            await factory.connect(creator).createPool(await testToken.getAddress());
            console.log("✅ Pool created successfully");
        }
        
        const [poolAddress] = await factory.predictPoolAddress(creator.address, await testToken.getAddress());
        const vault = await ethers.getContractAt("RewardPoolImplementation", poolAddress);
        console.log(`✅ Pool address: ${poolAddress}`);
        
        // Test 2: Fund Vault
        console.log("\n💰 Funding vault...");
        const fundAmount = ethers.parseUnits("100", 6); // 100 USDC
        await testToken.mint(deployer.address, fundAmount);
        await testToken.approve(poolAddress, fundAmount);
        await vault.fund(fundAmount);
        
        const vaultBalance = await testToken.balanceOf(poolAddress);
        console.log(`✅ Vault funded: ${ethers.formatUnits(vaultBalance, 6)} USDC`);
        
        // Test 3: Generate Signature and Claim
        console.log("\n✍️ Generating signature and claiming...");
        const claimAmount = ethers.parseUnits("50", 6);
        const currentBlock = await ethers.provider.getBlock('latest');
        const deadline = currentBlock!.timestamp + 3600;
        const chainId = (await ethers.provider.getNetwork()).chainId;
        
        // EIP-712 signature
        const domain = {
            name: "FactoryVault",
            version: "1",
            chainId: Number(chainId),
            verifyingContract: poolAddress
        };

        const types = {
            Claim: [
                { name: "account", type: "address" },
                { name: "cumulativeAmount", type: "uint256" },
                { name: "deadline", type: "uint256" }
            ]
        };

        const value = {
            account: claimer.address,
            cumulativeAmount: claimAmount.toString(),
            deadline
        };

        const signature = await deployer.signTypedData(domain, types, value);
        
        // Execute claim
        const tx = await vault.payWithSig(
            claimer.address,
            claimAmount,
            deadline,
            signature
        );
        
        const receipt = await tx.wait();
        const claimerBalance = await testToken.balanceOf(claimer.address);
        
        console.log(`✅ Claim successful!`);
        console.log(`   Claimer balance: ${ethers.formatUnits(claimerBalance, 6)} USDC`);
        console.log(`   Gas used: ${receipt!.gasUsed.toString()}`);
        
        // Test 4: Batch Claim via ClaimRouter
        console.log("\n📦 Testing batch claim...");
        const batchClaimAmount = ethers.parseUnits("25", 6);
        const cumulativeAmount = claimAmount + batchClaimAmount; // 75 USDC total
        
        const batchSignature = await deployer.signTypedData(domain, types, {
            account: claimer.address,
            cumulativeAmount: cumulativeAmount.toString(),
            deadline: deadline + 100
        });
        
        const claimData = [{
            vault: poolAddress,
            account: claimer.address,
            cumulativeAmount: cumulativeAmount,
            deadline: deadline + 100,
            signature: batchSignature
        }];
        
        const batchTx = await claimRouter.claimAll(claimData);
        const batchReceipt = await batchTx.wait();
        
        const finalBalance = await testToken.balanceOf(claimer.address);
        console.log(`✅ Batch claim successful!`);
        console.log(`   Final balance: ${ethers.formatUnits(finalBalance, 6)} USDC`);
        console.log(`   Batch gas: ${batchReceipt!.gasUsed.toString()}`);
        
        console.log("\n🎉 ALL TESTS PASSED!");
        console.log("=".repeat(50));
        console.log("✅ Pool creation works");
        console.log("✅ Vault funding works");
        console.log("✅ EIP-712 signatures work");
        console.log("✅ Individual claims work");
        console.log("✅ Batch claims work");
        console.log("✅ System is fully functional!");
        
    } catch (error) {
        console.error("❌ Test failed:", error);
        process.exit(1);
    }
}

main()
    .then(() => {
        console.log("\n🚀 Deploy and test completed successfully!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ Failed:", error);
        process.exit(1);
    });