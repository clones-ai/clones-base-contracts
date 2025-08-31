import { ethers } from "hardhat";

/**
 * Robust deployment script for Base Sepolia with nonce management
 * Deploys the factory system step by step with proper gas handling
 */
async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);

    console.log("🚀 Safe Factory System Deployment");
    console.log("Network:", network.name);
    console.log("Chain ID:", chainId);
    console.log("Deployer:", deployer.address);
    console.log("Balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)));

    // Network validation
    if (chainId !== 84532 && chainId !== 31337 && chainId !== 8453) {
        throw new Error("❌ This script supports Base Sepolia (84532), Base Mainnet (8453), or local (31337)");
    }

    // Base Sepolia test tokens
    const SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
    const SEPOLIA_WETH = "0x4200000000000000000000000000000000000006";
    const SEPOLIA_CLONES = "0x15eB86c7E54B350bf936d916Df33AEF697202E29";

    // Base Mainnet tokens
    const MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const MAINNET_WETH = "0x4200000000000000000000000000000000000006";
    const MAINNET_CLONES = "?";

    // Deploy parameters - use deployer for all roles on testnet
    const treasuryAddress = deployer.address;
    const timelockAddress = deployer.address;
    const guardianAddress = deployer.address;
    const publisherAddress = deployer.address;

    console.log("\n📋 Deployment Parameters:");
    console.log("Treasury:", treasuryAddress);
    console.log("Timelock:", timelockAddress);
    console.log("Guardian:", guardianAddress);
    console.log("Publisher:", publisherAddress);

    let implementationAddress = "";
    let factoryAddress = "";
    let claimRouterAddress = "";

    try {
        // Step 1: Deploy Implementation
        console.log("\n🔧 Step 1: Deploying RewardPoolImplementation...");
        let nonce = await deployer.getNonce();
        console.log(`Current nonce: ${nonce}`);

        const ImplementationFactory = await ethers.getContractFactory("RewardPoolImplementation");
        const implementation = await ImplementationFactory.deploy({
            nonce: nonce,
            gasLimit: 3000000,
            gasPrice: ethers.parseUnits("1.5", "gwei")
        });

        console.log(`Transaction sent: ${implementation.deploymentTransaction()?.hash}`);
        await implementation.waitForDeployment();
        implementationAddress = await implementation.getAddress();
        console.log("✅ RewardPoolImplementation deployed:", implementationAddress);

        // Wait before next deployment
        console.log("⏱️  Waiting 5 seconds...");
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Step 2: Deploy Factory
        console.log("\n🏭 Step 2: Deploying RewardPoolFactory...");
        nonce = await deployer.getNonce();
        console.log(`Current nonce: ${nonce}`);

        const FactoryContractFactory = await ethers.getContractFactory("RewardPoolFactory");
        const factory = await FactoryContractFactory.deploy(
            implementationAddress,
            treasuryAddress,
            timelockAddress,
            guardianAddress,
            publisherAddress,
            {
                nonce: nonce,
                gasLimit: 3000000,
                gasPrice: ethers.parseUnits("1.5", "gwei")
            }
        );

        console.log(`Transaction sent: ${factory.deploymentTransaction()?.hash}`);
        await factory.waitForDeployment();
        factoryAddress = await factory.getAddress();
        console.log("✅ RewardPoolFactory deployed:", factoryAddress);

        // Wait before next deployment
        console.log("⏱️  Waiting 5 seconds...");
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Step 3: Deploy ClaimRouter
        console.log("\n🛣️  Step 3: Deploying ClaimRouter...");
        nonce = await deployer.getNonce();
        console.log(`Current nonce: ${nonce}`);

        const ClaimRouterFactory = await ethers.getContractFactory("ClaimRouter");
        const claimRouter = await ClaimRouterFactory.deploy(
            timelockAddress,
            {
                nonce: nonce,
                gasLimit: 2000000,
                gasPrice: ethers.parseUnits("1.5", "gwei")
            }
        );

        console.log(`Transaction sent: ${claimRouter.deploymentTransaction()?.hash}`);
        await claimRouter.waitForDeployment();
        claimRouterAddress = await claimRouter.getAddress();
        console.log("✅ ClaimRouter deployed:", claimRouterAddress);

        // Wait for confirmations
        console.log("⏱️  Waiting 10 seconds for confirmations...");
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Step 4: Configuration
        console.log("\n⚙️  Step 4: Configuring system...");

        // Approve factory in ClaimRouter
        console.log("Approving factory in ClaimRouter...");
        nonce = await deployer.getNonce();
        const approveTx = await claimRouter.setFactoryApproved(factoryAddress, true, {
            nonce: nonce,
            gasLimit: 100000,
            gasPrice: ethers.parseUnits("1.5", "gwei")
        });
        await approveTx.wait();
        console.log("✅ Factory approved in ClaimRouter");


        // Wait for confirmations
        console.log("⏱️  Waiting 5 seconds for confirmations...");
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Add tokens to allowlist
        const usdcAddress = chainId === 84532 ? SEPOLIA_USDC : MAINNET_USDC;
        const wethAddress = chainId === 84532 ? SEPOLIA_WETH : MAINNET_WETH;
        const clonesAddress = chainId === 84532 ? SEPOLIA_CLONES : MAINNET_CLONES;

        console.log("Adding USDC to allowlist...");
        nonce = await deployer.getNonce();
        const usdcTx = await factory.setTokenAllowed(usdcAddress, true, {
            nonce: nonce,
            gasLimit: 100000,
            gasPrice: ethers.parseUnits("1.5", "gwei")
        });
        await usdcTx.wait();

        // Wait for confirmations
        console.log("⏱️  Waiting 5 seconds for confirmations...");
        await new Promise(resolve => setTimeout(resolve, 5000));

        console.log("Adding WETH to allowlist...");
        nonce = await deployer.getNonce();
        const wethTx = await factory.setTokenAllowed(wethAddress, true, {
            nonce: nonce,
            gasLimit: 100000,
            gasPrice: ethers.parseUnits("1.5", "gwei")
        });
        await wethTx.wait();

        // Wait for confirmations
        console.log("⏱️  Waiting 5 seconds for confirmations...");
        await new Promise(resolve => setTimeout(resolve, 5000));

        console.log("Adding CLONES to allowlist...");
        nonce = await deployer.getNonce();
        const clonesTx = await factory.setTokenAllowed(clonesAddress, true, {
            nonce: nonce,
            gasLimit: 100000,
            gasPrice: ethers.parseUnits("1.5", "gwei")
        });
        await clonesTx.wait();

        // Verify tokens are allowed
        await new Promise(resolve => setTimeout(resolve, 3000));
        const usdcAllowed = await factory.allowedTokens(usdcAddress);
        const wethAllowed = await factory.allowedTokens(wethAddress);
        const clonesAllowed = await factory.allowedTokens(clonesAddress);

        console.log(`✅ USDC allowed: ${usdcAllowed}`);
        console.log(`✅ WETH allowed: ${wethAllowed}`);
        console.log(`✅ CLONES allowed: ${clonesAllowed}`);

        // Step 5: Test Pool Creation
        console.log("\n🏊 Step 5: Testing pool creation...");
        nonce = await deployer.getNonce();
        const createTx = await factory.createPool(usdcAddress, {
            nonce: nonce,
            gasLimit: 500000,
            gasPrice: ethers.parseUnits("1.5", "gwei")
        });
        await createTx.wait();

        const [poolAddress] = await factory.predictPoolAddress(deployer.address, usdcAddress);
        console.log("✅ Test pool created:", poolAddress);

        // Summary
        console.log("\n📊 Deployment Summary");
        console.log("=".repeat(60));
        console.log(`Network: ${network.name} (${chainId})`);
        console.log(`RewardPoolImplementation: ${implementationAddress}`);
        console.log(`RewardPoolFactory: ${factoryAddress}`);
        console.log(`ClaimRouter: ${claimRouterAddress}`);
        console.log(`USDC: ${usdcAddress}`);
        console.log(`WETH: ${wethAddress}`);
        console.log(`CLONES: ${clonesAddress}`);
        console.log(`Test Pool: ${poolAddress}`);
        console.log("=".repeat(60));

        // Save deployment info
        const deploymentInfo = {
            network: network.name,
            chainId: chainId,
            timestamp: new Date().toISOString(),
            contracts: {
                implementation: implementationAddress,
                factory: factoryAddress,
                claimRouter: claimRouterAddress,
                tokens: {
                    usdc: usdcAddress,
                    weth: wethAddress,
                    clones: clonesAddress
                },
                testPools: {
                    usdcPool: poolAddress
                }
            },
            config: {
                treasury: treasuryAddress,
                timelock: timelockAddress,
                guardian: guardianAddress,
                publisher: publisherAddress
            },
            verification: {
                implementation: `npx hardhat verify --network ${network.name} ${implementationAddress}`,
                factory: `npx hardhat verify --network ${network.name} ${factoryAddress} "${implementationAddress}" "${treasuryAddress}" "${timelockAddress}" "${guardianAddress}" "${publisherAddress}"`,
                claimRouter: `npx hardhat verify --network ${network.name} ${claimRouterAddress} "${timelockAddress}"`
            }
        };

        const fs = require("fs");
        const path = `./deployments/${network.name}-${chainId}-safe.json`;
        fs.writeFileSync(path, JSON.stringify(deploymentInfo, null, 2));
        console.log(`💾 Deployment info saved to ${path}`);

        console.log("\n🎉 Safe deployment completed successfully!");
        console.log("\n📝 Verification Commands:");
        console.log(deploymentInfo.verification.implementation);
        console.log(deploymentInfo.verification.factory);
        console.log(deploymentInfo.verification.claimRouter);

    } catch (error) {
        console.error("❌ Deployment failed:", error);

        if (implementationAddress || factoryAddress || claimRouterAddress) {
            console.log("\n📊 Partial Deployment State:");
            if (implementationAddress) console.log(`Implementation: ${implementationAddress}`);
            if (factoryAddress) console.log(`Factory: ${factoryAddress}`);
            if (claimRouterAddress) console.log(`ClaimRouter: ${claimRouterAddress}`);
        }

        throw error;
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Script failed:", error);
        process.exit(1);
    });