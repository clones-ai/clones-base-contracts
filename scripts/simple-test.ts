import { ethers } from "hardhat";

/**
 * Simple test to validate the deployed factory system
 */
async function main() {
    console.log("🔍 Simple Factory System Test\n");

    const [deployer, creator, claimer] = await ethers.getSigners();
    
    // Load deployment
    const deploymentInfo = require("../deployments/hardhat-31337.json");
    
    // Get contract instances
    const factory = await ethers.getContractAt("RewardPoolFactory", deploymentInfo.contracts.factory);
    const testToken = await ethers.getContractAt("TestToken", deploymentInfo.contracts.testTokens.usdc);
    
    console.log("📋 Test Parameters:");
    console.log(`Factory: ${deploymentInfo.contracts.factory}`);
    console.log(`Test Token: ${deploymentInfo.contracts.testTokens.usdc}`);
    console.log(`Creator: ${creator.address}\n`);

    try {
        // Test 1: Check if pool already exists
        const poolExists = await factory.poolExists(creator.address, await testToken.getAddress());
        console.log(`Pool exists: ${poolExists}`);
        
        let poolAddress: string;
        
        if (poolExists) {
            // Get existing pool address
            const [existingAddress] = await factory.predictPoolAddress(creator.address, await testToken.getAddress());
            poolAddress = existingAddress;
            console.log(`Using existing pool: ${poolAddress}`);
        } else {
            // Create new pool
            console.log("Creating new pool...");
            const tx = await factory.connect(creator).createPool(await testToken.getAddress());
            await tx.wait();
            
            const [newAddress] = await factory.predictPoolAddress(creator.address, await testToken.getAddress());
            poolAddress = newAddress;
            console.log(`✅ New pool created: ${poolAddress}`);
        }
        
        // Test 2: Validate pool instance
        const vault = await ethers.getContractAt("RewardPoolImplementation", poolAddress);
        const vaultToken = await vault.token();
        const vaultFactory = await vault.factory();
        
        console.log("\n🔍 Pool Validation:");
        console.log(`Vault token: ${vaultToken}`);
        console.log(`Expected token: ${await testToken.getAddress()}`);
        console.log(`Token match: ${vaultToken.toLowerCase() === (await testToken.getAddress()).toLowerCase()}`);
        
        console.log(`Vault factory: ${vaultFactory}`);
        console.log(`Expected factory: ${await factory.getAddress()}`);
        console.log(`Factory match: ${vaultFactory.toLowerCase() === (await factory.getAddress()).toLowerCase()}`);
        
        // Test 3: Fund and claim test
        console.log("\n💰 Fund and Claim Test:");
        
        // Fund vault
        const fundAmount = ethers.parseUnits("100", 6); // 100 USDC
        await testToken.mint(deployer.address, fundAmount);
        await testToken.approve(poolAddress, fundAmount);
        await vault.fund(fundAmount);
        
        console.log(`✅ Vault funded with ${ethers.formatUnits(fundAmount, 6)} USDC`);
        
        // Check vault balance
        const vaultBalance = await testToken.balanceOf(poolAddress);
        console.log(`Vault balance: ${ethers.formatUnits(vaultBalance, 6)} USDC`);
        
        // Generate signature and claim
        const claimAmount = ethers.parseUnits("50", 6);
        const deadline = (await ethers.provider.getBlock('latest'))!.timestamp + 3600;
        const chainId = (await ethers.provider.getNetwork()).chainId;
        
        // EIP-712 domain and types
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
        const claimTx = await vault.payWithSig(
            claimer.address,
            claimAmount,
            deadline,
            signature
        );
        
        const claimReceipt = await claimTx.wait();
        const claimerBalance = await testToken.balanceOf(claimer.address);
        
        console.log(`✅ Claim successful!`);
        console.log(`Claimer balance: ${ethers.formatUnits(claimerBalance, 6)} USDC`);
        console.log(`Gas used: ${claimReceipt!.gasUsed.toString()}`);
        
        // Test 4: Publisher info
        console.log("\n👤 Publisher Info:");
        const [currentPub, oldPub, graceEnd] = await factory.getPublisherInfo();
        console.log(`Current publisher: ${currentPub}`);
        console.log(`Old publisher: ${oldPub}`);
        console.log(`Grace end time: ${graceEnd}`);
        
        console.log("\n🎉 All tests passed! Factory system is working correctly.");
        
    } catch (error) {
        console.error("❌ Test failed:", error);
        process.exit(1);
    }
}

main()
    .then(() => {
        console.log("\n✅ Simple test completed successfully!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ Test failed:", error);
        process.exit(1);
    });