import { ethers } from "hardhat";

/**
 * Configuration script for mainnet deployment
 * Configures the already deployed factory system without recreating contracts
 */
async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);

    console.log("🔧 Configuring Factory System");
    console.log("Network:", network.name);
    console.log("Chain ID:", chainId);
    console.log("Deployer:", deployer.address);
    console.log("Balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)));

    // Network validation
    if (chainId !== 8453 && chainId !== 84532) {
        throw new Error("❌ This script supports Base Mainnet (8453) or Base Sepolia (84532)");
    }

    // Already deployed contract addresses
    const IMPLEMENTATION_ADDRESS = "0xf5FBB3bD5Ee86746351a857a8f5Ae414898F9816";
    const FACTORY_ADDRESS = "0xda704A5bAC54FfE3A56D3B48a7EF6f3279557829";
    const CLAIM_ROUTER_ADDRESS = "0x3cF83B17163681d48B5fdd926eFcDA9940cB49fc";

    // Token addresses
    const MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const MAINNET_WETH = "0x4200000000000000000000000000000000000006";
    const MAINNET_CLONES = "0xaadd98Ad4660008C917C6FE7286Bc54b2eEF894d";

    console.log("\n📋 Configuration Parameters:");
    console.log("Implementation:", IMPLEMENTATION_ADDRESS);
    console.log("Factory:", FACTORY_ADDRESS);
    console.log("ClaimRouter:", CLAIM_ROUTER_ADDRESS);

    try {
        // Connect to factory
        const factory = await ethers.getContractAt("RewardPoolFactory", FACTORY_ADDRESS);
        
        // Verify factory is deployed and working
        console.log("\n🔍 Verifying factory deployment...");
        const implementation = await factory.POOL_IMPLEMENTATION();
        if (implementation !== IMPLEMENTATION_ADDRESS) {
            throw new Error(`❌ Factory implementation mismatch: ${implementation} !== ${IMPLEMENTATION_ADDRESS}`);
        }
        console.log("✅ Factory verified");

        // Step 1: Configure allowed tokens
        console.log("\n💰 Step 1: Configuring token allowlist...");
        
        let nonce = await deployer.getNonce();
        
        // Check if tokens are already allowed
        const usdcAllowed = await factory.allowedTokens(MAINNET_USDC);
        const wethAllowed = await factory.allowedTokens(MAINNET_WETH);
        const clonesAllowed = await factory.allowedTokens(MAINNET_CLONES);

        console.log(`USDC currently allowed: ${usdcAllowed}`);
        console.log(`WETH currently allowed: ${wethAllowed}`);
        console.log(`CLONES currently allowed: ${clonesAllowed}`);

        // Add USDC if not already allowed
        if (!usdcAllowed) {
            console.log("Adding USDC to allowlist...");
            const usdcTx = await factory.setTokenAllowed(MAINNET_USDC, true, {
                nonce: nonce++,
                gasLimit: 100000,
                gasPrice: ethers.parseUnits("1.5", "gwei")
            });
            await usdcTx.wait();
            console.log("✅ USDC added to allowlist");
            
            // Wait for confirmation
            await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
            console.log("✅ USDC already allowed");
        }

        // Add WETH if not already allowed
        if (!wethAllowed) {
            console.log("Adding WETH to allowlist...");
            const wethTx = await factory.setTokenAllowed(MAINNET_WETH, true, {
                nonce: nonce++,
                gasLimit: 100000,
                gasPrice: ethers.parseUnits("1.5", "gwei")
            });
            await wethTx.wait();
            console.log("✅ WETH added to allowlist");
            
            // Wait for confirmation
            await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
            console.log("✅ WETH already allowed");
        }

        // Add CLONES if not already allowed
        if (!clonesAllowed) {
            console.log("Adding CLONES to allowlist...");
            const clonesTx = await factory.setTokenAllowed(MAINNET_CLONES, true, {
                nonce: nonce++,
                gasLimit: 100000,
                gasPrice: ethers.parseUnits("1.5", "gwei")
            });
            await clonesTx.wait();
            console.log("✅ CLONES added to allowlist");
            
            // Wait for confirmation
            await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
            console.log("✅ CLONES already allowed");
        }

        // Step 2: Test pool creation
        console.log("\n🏊 Step 2: Testing pool creation...");
        
        // Check if pool already exists
        const [poolAddress] = await factory.predictPoolAddress(deployer.address, MAINNET_USDC);
        console.log("Predicted pool address:", poolAddress);
        
        // Check if pool exists
        const poolCode = await ethers.provider.getCode(poolAddress);
        if (poolCode === "0x") {
            console.log("Creating test USDC pool...");
            nonce = await deployer.getNonce();
            const createTx = await factory.createPool(MAINNET_USDC, {
                nonce: nonce,
                gasLimit: 500000,
                gasPrice: ethers.parseUnits("1.5", "gwei")
            });
            await createTx.wait();
            console.log("✅ Test USDC pool created:", poolAddress);
        } else {
            console.log("✅ Test USDC pool already exists:", poolAddress);
        }

        // Final verification
        console.log("\n🔍 Final verification...");
        const finalUsdcAllowed = await factory.allowedTokens(MAINNET_USDC);
        const finalWethAllowed = await factory.allowedTokens(MAINNET_WETH);
        const finalClonesAllowed = await factory.allowedTokens(MAINNET_CLONES);

        console.log(`✅ USDC allowed: ${finalUsdcAllowed}`);
        console.log(`✅ WETH allowed: ${finalWethAllowed}`);
        console.log(`✅ CLONES allowed: ${finalClonesAllowed}`);

        // Summary
        console.log("\n📊 Configuration Summary");
        console.log("=".repeat(60));
        console.log(`Network: ${network.name} (${chainId})`);
        console.log(`RewardPoolImplementation: ${IMPLEMENTATION_ADDRESS}`);
        console.log(`RewardPoolFactory: ${FACTORY_ADDRESS}`);
        console.log(`ClaimRouter: ${CLAIM_ROUTER_ADDRESS}`);
        console.log(`USDC: ${MAINNET_USDC} (allowed: ${finalUsdcAllowed})`);
        console.log(`WETH: ${MAINNET_WETH} (allowed: ${finalWethAllowed})`);
        console.log(`CLONES: ${MAINNET_CLONES} (allowed: ${finalClonesAllowed})`);
        console.log(`Test Pool: ${poolAddress}`);
        console.log("=".repeat(60));

        console.log("\n⚠️  IMPORTANT: ClaimRouter factory approval still needed!");
        console.log("The timelock must call:");
        console.log(`claimRouter.setFactoryApproved("${FACTORY_ADDRESS}", true)`);
        console.log("This requires timelock governance approval.");

        // Save configuration info
        const configInfo = {
            network: network.name,
            chainId: chainId,
            timestamp: new Date().toISOString(),
            status: "configured",
            contracts: {
                implementation: IMPLEMENTATION_ADDRESS,
                factory: FACTORY_ADDRESS,
                claimRouter: CLAIM_ROUTER_ADDRESS,
                tokens: {
                    usdc: { address: MAINNET_USDC, allowed: finalUsdcAllowed },
                    weth: { address: MAINNET_WETH, allowed: finalWethAllowed },
                    clones: { address: MAINNET_CLONES, allowed: finalClonesAllowed }
                },
                testPools: {
                    usdcPool: poolAddress
                }
            },
            pendingGovernance: {
                claimRouterApproval: `claimRouter.setFactoryApproved("${FACTORY_ADDRESS}", true)`
            }
        };

        const fs = require("fs");
        const path = `./deployments/${network.name}-${chainId}-configured.json`;
        fs.writeFileSync(path, JSON.stringify(configInfo, null, 2));
        console.log(`💾 Configuration info saved to ${path}`);

        console.log("\n🎉 Configuration completed successfully!");
        console.log("🏭 Factory system is ready for use!");
        console.log("📝 See pending governance tasks above.");

        console.log("\n📝 Verification Commands:");
        console.log(`npx hardhat verify --network ${network.name} ${IMPLEMENTATION_ADDRESS}`);
        console.log(`npx hardhat verify --network ${network.name} ${FACTORY_ADDRESS} "${IMPLEMENTATION_ADDRESS}" "${process.env.PLATFORM_TREASURY_ADDRESS || deployer.address}" "${process.env.TIMELOCK_ADDRESS || deployer.address}" "${process.env.GUARDIAN_ADDRESS || deployer.address}" "${process.env.PUBLISHER_ADDRESS || deployer.address}"`);
        console.log(`npx hardhat verify --network ${network.name} ${CLAIM_ROUTER_ADDRESS} "${process.env.TIMELOCK_ADDRESS || deployer.address}"`);

    } catch (error) {
        console.error("❌ Configuration failed:", error);
        throw error;
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Script failed:", error);
        process.exit(1);
    });