import { ethers } from "hardhat";

/**
 * COMPLETE GOVERNANCE CONFIGURATION
 * This script must be executed by the TIMELOCK address
 * Configures both Factory tokens and ClaimRouter approval
 */
async function main() {
    const [signer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);

    console.log("🏛️  TIMELOCK GOVERNANCE: Complete System Configuration");
    console.log("Network:", network.name);
    console.log("Chain ID:", chainId);
    console.log("Signer:", signer.address);
    console.log("Balance:", ethers.formatEther(await signer.provider.getBalance(signer.address)));

    // Contract addresses
    const IMPLEMENTATION_ADDRESS = "0xf5FBB3bD5Ee86746351a857a8f5Ae414898F9816";
    const FACTORY_ADDRESS = "0xda704A5bAC54FfE3A56D3B48a7EF6f3279557829";
    const CLAIM_ROUTER_ADDRESS = "0x3cF83B17163681d48B5fdd926eFcDA9940cB49fc";
    const TIMELOCK_ADDRESS = "0x1320b33b21dD4F79735d8555eE49C6650eacc271";

    // Token addresses
    const MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const MAINNET_WETH = "0x4200000000000000000000000000000000000006";
    const MAINNET_CLONES = "0xaadd98Ad4660008C917C6FE7286Bc54b2eEF894d";

    console.log("\n📋 Configuration Parameters:");
    console.log("Expected timelock:", TIMELOCK_ADDRESS);
    console.log("Factory:", FACTORY_ADDRESS);
    console.log("ClaimRouter:", CLAIM_ROUTER_ADDRESS);

    // CRITICAL: Verify signer is timelock
    if (signer.address.toLowerCase() !== TIMELOCK_ADDRESS.toLowerCase()) {
        console.error("❌ CRITICAL: Signer is not the timelock address!");
        console.error(`Expected: ${TIMELOCK_ADDRESS}`);
        console.error(`Actual: ${signer.address}`);
        throw new Error("UNAUTHORIZED: Only timelock can execute governance actions");
    }

    try {
        // Connect to contracts
        const factory = await ethers.getContractAt("RewardPoolFactory", FACTORY_ADDRESS);
        const claimRouter = await ethers.getContractAt("ClaimRouter", CLAIM_ROUTER_ADDRESS);
        
        // Verify timelock addresses
        const factoryTimelock = await factory.TIMELOCK();
        const routerTimelock = await claimRouter.TIMELOCK();
        
        if (factoryTimelock.toLowerCase() !== TIMELOCK_ADDRESS.toLowerCase()) {
            throw new Error(`Factory timelock mismatch: ${factoryTimelock} !== ${TIMELOCK_ADDRESS}`);
        }
        if (routerTimelock.toLowerCase() !== TIMELOCK_ADDRESS.toLowerCase()) {
            throw new Error(`ClaimRouter timelock mismatch: ${routerTimelock} !== ${TIMELOCK_ADDRESS}`);
        }
        console.log("✅ Timelock verification passed");

        let nonce = await signer.getNonce();
        const gasPrice = ethers.parseUnits("2.0", "gwei");

        // STEP 1: Configure Factory Token Allowlist
        console.log("\n💰 STEP 1: Configuring Factory Token Allowlist...");
        
        // Check current status
        const usdcAllowed = await factory.allowedTokens(MAINNET_USDC);
        const wethAllowed = await factory.allowedTokens(MAINNET_WETH);
        const clonesAllowed = await factory.allowedTokens(MAINNET_CLONES);

        console.log(`USDC currently allowed: ${usdcAllowed}`);
        console.log(`WETH currently allowed: ${wethAllowed}`);
        console.log(`CLONES currently allowed: ${clonesAllowed}`);

        // Add USDC
        if (!usdcAllowed) {
            console.log("Approving USDC...");
            const usdcTx = await factory.setTokenAllowed(MAINNET_USDC, true, {
                nonce: nonce++,
                gasLimit: 150000,
                gasPrice: gasPrice
            });
            await usdcTx.wait();
            console.log("✅ USDC approved");
        } else {
            console.log("✅ USDC already approved");
        }

        // Add WETH
        if (!wethAllowed) {
            console.log("Approving WETH...");
            const wethTx = await factory.setTokenAllowed(MAINNET_WETH, true, {
                nonce: nonce++,
                gasLimit: 150000,
                gasPrice: gasPrice
            });
            await wethTx.wait();
            console.log("✅ WETH approved");
        } else {
            console.log("✅ WETH already approved");
        }

        // Add CLONES
        if (!clonesAllowed) {
            console.log("Approving CLONES...");
            const clonesTx = await factory.setTokenAllowed(MAINNET_CLONES, true, {
                nonce: nonce++,
                gasLimit: 150000,
                gasPrice: gasPrice
            });
            await clonesTx.wait();
            console.log("✅ CLONES approved");
        } else {
            console.log("✅ CLONES already approved");
        }

        // STEP 2: Approve Factory in ClaimRouter
        console.log("\n🛣️  STEP 2: Approving Factory in ClaimRouter...");
        
        const factoryApproved = await claimRouter.approvedFactories(FACTORY_ADDRESS);
        console.log(`Factory currently approved in ClaimRouter: ${factoryApproved}`);

        if (!factoryApproved) {
            console.log("Approving factory in ClaimRouter...");
            const approveTx = await claimRouter.setFactoryApproved(FACTORY_ADDRESS, true, {
                nonce: nonce++,
                gasLimit: 150000,
                gasPrice: gasPrice
            });
            await approveTx.wait();
            console.log("✅ Factory approved in ClaimRouter");
        } else {
            console.log("✅ Factory already approved in ClaimRouter");
        }

        // STEP 3: Final Verification
        console.log("\n🔍 STEP 3: Final System Verification...");
        
        const finalUsdcAllowed = await factory.allowedTokens(MAINNET_USDC);
        const finalWethAllowed = await factory.allowedTokens(MAINNET_WETH);
        const finalClonesAllowed = await factory.allowedTokens(MAINNET_CLONES);
        const finalFactoryApproved = await claimRouter.approvedFactories(FACTORY_ADDRESS);

        console.log(`✅ USDC allowed in factory: ${finalUsdcAllowed}`);
        console.log(`✅ WETH allowed in factory: ${finalWethAllowed}`);
        console.log(`✅ CLONES allowed in factory: ${finalClonesAllowed}`);
        console.log(`✅ Factory approved in ClaimRouter: ${finalFactoryApproved}`);

        // STEP 4: Test Pool Creation (Optional)
        console.log("\n🏊 STEP 4: Testing Pool Creation (if needed)...");
        
        const [poolAddress] = await factory.predictPoolAddress(signer.address, MAINNET_USDC);
        console.log("Predicted USDC pool address:", poolAddress);
        
        const poolCode = await ethers.provider.getCode(poolAddress);
        if (poolCode === "0x") {
            console.log("Creating test USDC pool...");
            nonce = await signer.getNonce();
            const createTx = await factory.createPool(MAINNET_USDC, {
                nonce: nonce,
                gasLimit: 500000,
                gasPrice: gasPrice
            });
            await createTx.wait();
            console.log("✅ Test USDC pool created:", poolAddress);
        } else {
            console.log("✅ Test USDC pool already exists:", poolAddress);
        }

        // Final Summary
        console.log("\n📊 GOVERNANCE CONFIGURATION SUMMARY");
        console.log("=".repeat(70));
        console.log(`Network: ${network.name} (${chainId})`);
        console.log(`Timelock: ${TIMELOCK_ADDRESS}`);
        console.log(`RewardPoolImplementation: ${IMPLEMENTATION_ADDRESS}`);
        console.log(`RewardPoolFactory: ${FACTORY_ADDRESS}`);
        console.log(`ClaimRouter: ${CLAIM_ROUTER_ADDRESS}`);
        console.log("─".repeat(70));
        console.log("TOKEN ALLOWLIST:");
        console.log(`  USDC (${MAINNET_USDC}): ${finalUsdcAllowed}`);
        console.log(`  WETH (${MAINNET_WETH}): ${finalWethAllowed}`);
        console.log(`  CLONES (${MAINNET_CLONES}): ${finalClonesAllowed}`);
        console.log("─".repeat(70));
        console.log("CLAIMROUTER CONFIGURATION:");
        console.log(`  Factory approved: ${finalFactoryApproved}`);
        console.log("─".repeat(70));
        console.log("TEST POOLS:");
        console.log(`  USDC Pool: ${poolAddress}`);
        console.log("=".repeat(70));

        // Save governance record
        const governanceRecord = {
            network: network.name,
            chainId: chainId,
            timestamp: new Date().toISOString(),
            status: "FULLY_CONFIGURED",
            timelock: TIMELOCK_ADDRESS,
            contracts: {
                implementation: IMPLEMENTATION_ADDRESS,
                factory: FACTORY_ADDRESS,
                claimRouter: CLAIM_ROUTER_ADDRESS
            },
            configuration: {
                tokenAllowlist: {
                    usdc: { address: MAINNET_USDC, allowed: finalUsdcAllowed },
                    weth: { address: MAINNET_WETH, allowed: finalWethAllowed },
                    clones: { address: MAINNET_CLONES, allowed: finalClonesAllowed }
                },
                claimRouter: {
                    factoryApproved: finalFactoryApproved
                },
                testPools: {
                    usdcPool: poolAddress
                }
            }
        };

        const fs = require("fs");
        const path = `./deployments/governance-${Date.now()}-full-config.json`;
        fs.writeFileSync(path, JSON.stringify(governanceRecord, null, 2));
        console.log(`💾 Governance record saved to ${path}`);

        console.log("\n🎉 COMPLETE GOVERNANCE CONFIGURATION SUCCESSFUL!");
        console.log("🚀 Factory system is FULLY OPERATIONAL!");
        console.log("✅ All tokens approved, ClaimRouter configured");
        console.log("🏭 Ready for production use!");

        console.log("\n📝 Verification Commands:");
        console.log(`npx hardhat verify --network ${network.name} ${IMPLEMENTATION_ADDRESS}`);
        console.log(`npx hardhat verify --network ${network.name} ${FACTORY_ADDRESS} "${IMPLEMENTATION_ADDRESS}" "${process.env.PLATFORM_TREASURY_ADDRESS}" "${process.env.TIMELOCK_ADDRESS}" "${process.env.GUARDIAN_ADDRESS}" "${process.env.PUBLISHER_ADDRESS}"`);
        console.log(`npx hardhat verify --network ${network.name} ${CLAIM_ROUTER_ADDRESS} "${process.env.TIMELOCK_ADDRESS}"`);

    } catch (error) {
        console.error("❌ Governance configuration failed:", error);
        throw error;
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Governance script failed:", error);
        process.exit(1);
    });