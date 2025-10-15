import { ethers } from "hardhat";

/**
 * Governance script for timelock to approve factory in ClaimRouter
 * This script must be executed by the timelock address
 */
async function main() {
    const [signer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);

    console.log("🏛️  Governance: Approve Factory in ClaimRouter");
    console.log("Network:", network.name);
    console.log("Chain ID:", chainId);
    console.log("Signer:", signer.address);
    console.log("Balance:", ethers.formatEther(await signer.provider.getBalance(signer.address)));

    // Contract addresses
    const FACTORY_ADDRESS = "0xda704A5bAC54FfE3A56D3B48a7EF6f3279557829";
    const CLAIM_ROUTER_ADDRESS = "0x3cF83B17163681d48B5fdd926eFcDA9940cB49fc";
    const TIMELOCK_ADDRESS = "0x1320b33b21dD4F79735d8555eE49C6650eacc271";

    console.log("\n📋 Governance Parameters:");
    console.log("Factory to approve:", FACTORY_ADDRESS);
    console.log("ClaimRouter:", CLAIM_ROUTER_ADDRESS);
    console.log("Expected timelock:", TIMELOCK_ADDRESS);

    // Verify signer is timelock
    if (signer.address.toLowerCase() !== TIMELOCK_ADDRESS.toLowerCase()) {
        console.error("❌ CRITICAL: Signer is not the timelock address!");
        console.error(`Expected: ${TIMELOCK_ADDRESS}`);
        console.error(`Actual: ${signer.address}`);
        throw new Error("Unauthorized: Only timelock can execute this governance action");
    }

    try {
        // Connect to ClaimRouter
        const claimRouter = await ethers.getContractAt("ClaimRouter", CLAIM_ROUTER_ADDRESS);
        
        // Verify ClaimRouter timelock
        const routerTimelock = await claimRouter.TIMELOCK();
        if (routerTimelock.toLowerCase() !== TIMELOCK_ADDRESS.toLowerCase()) {
            throw new Error(`ClaimRouter timelock mismatch: ${routerTimelock} !== ${TIMELOCK_ADDRESS}`);
        }
        console.log("✅ Timelock verification passed");

        // Check current approval status
        console.log("\n🔍 Checking current factory approval...");
        const currentlyApproved = await claimRouter.approvedFactories(FACTORY_ADDRESS);
        console.log(`Factory ${FACTORY_ADDRESS} currently approved: ${currentlyApproved}`);

        if (currentlyApproved) {
            console.log("✅ Factory is already approved!");
            console.log("No action needed.");
            return;
        }

        // Execute governance action
        console.log("\n🏛️  Executing governance approval...");
        const nonce = await signer.getNonce();
        
        const approveTx = await claimRouter.setFactoryApproved(FACTORY_ADDRESS, true, {
            nonce: nonce,
            gasLimit: 150000,
            gasPrice: ethers.parseUnits("2.0", "gwei")
        });

        console.log(`Transaction sent: ${approveTx.hash}`);
        console.log("⏳ Waiting for confirmation...");
        
        const receipt = await approveTx.wait();
        if (!receipt) {
            throw new Error("Transaction receipt is null");
        }
        console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);

        // Verify approval
        await new Promise(resolve => setTimeout(resolve, 3000));
        const newApprovalStatus = await claimRouter.approvedFactories(FACTORY_ADDRESS);
        
        if (newApprovalStatus) {
            console.log("✅ Factory successfully approved!");
        } else {
            throw new Error("Factory approval verification failed");
        }

        // Final summary
        console.log("\n📊 Governance Action Summary");
        console.log("=".repeat(60));
        console.log(`Network: ${network.name} (${chainId})`);
        console.log(`Timelock: ${TIMELOCK_ADDRESS}`);
        console.log(`ClaimRouter: ${CLAIM_ROUTER_ADDRESS}`);
        console.log(`Factory: ${FACTORY_ADDRESS}`);
        console.log(`Approved: ${newApprovalStatus}`);
        console.log(`Transaction: ${approveTx.hash}`);
        console.log(`Block: ${receipt.blockNumber}`);
        console.log("=".repeat(60));

        // Save governance record
        const governanceRecord = {
            network: network.name,
            chainId: chainId,
            timestamp: new Date().toISOString(),
            action: "approve_factory_in_claim_router",
            timelock: TIMELOCK_ADDRESS,
            claimRouter: CLAIM_ROUTER_ADDRESS,
            factory: FACTORY_ADDRESS,
            approved: newApprovalStatus,
            transaction: {
                hash: approveTx.hash,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed.toString()
            }
        };

        const fs = require("fs");
        const path = `./deployments/governance-${Date.now()}-factory-approval.json`;
        fs.writeFileSync(path, JSON.stringify(governanceRecord, null, 2));
        console.log(`💾 Governance record saved to ${path}`);

        console.log("\n🎉 Governance action completed successfully!");
        console.log("🚀 ClaimRouter can now process batch claims from this factory!");

    } catch (error) {
        console.error("❌ Governance action failed:", error);
        throw error;
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Governance script failed:", error);
        process.exit(1);
    });