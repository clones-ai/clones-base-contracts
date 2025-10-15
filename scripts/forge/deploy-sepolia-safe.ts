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
    const MAINNET_CLONES = "0xaadd98Ad4660008C917C6FE7286Bc54b2eEF894d";

    // Deploy parameters - read from environment or use deployer as fallback
    const treasuryAddress = process.env.PLATFORM_TREASURY_ADDRESS || deployer.address;
    const timelockAddress = process.env.TIMELOCK_ADDRESS || deployer.address;
    const guardianAddress = process.env.GUARDIAN_ADDRESS || deployer.address;
    const publisherAddress = process.env.PUBLISHER_ADDRESS || deployer.address;

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

        // Step 4: Generate Governance Configuration
        console.log("\n⚙️  Step 4: Generating governance configuration...");

        // Token addresses for the network
        const usdcAddress = chainId === 84532 ? SEPOLIA_USDC : MAINNET_USDC;
        const wethAddress = chainId === 84532 ? SEPOLIA_WETH : MAINNET_WETH;
        const clonesAddress = chainId === 84532 ? SEPOLIA_CLONES : MAINNET_CLONES;

        console.log("📋 Token addresses:");
        console.log(`USDC: ${usdcAddress}`);
        console.log(`WETH: ${wethAddress}`);
        console.log(`CLONES: ${clonesAddress}`);

        // Generate Safe transaction data
        const factoryInterface = new ethers.Interface([
            "function setTokenAllowed(address token, bool allowed) external"
        ]);
        
        const claimRouterInterface = new ethers.Interface([
            "function setFactoryApproved(address factory, bool approved) external"
        ]);

        const safeBatch = {
            version: "1.0",
            chainId: chainId.toString(),
            meta: {
                name: "Clones Factory System Configuration",
                description: "Configure token allowlist and ClaimRouter factory approval",
                txBuilderVersion: "1.16.5"
            },
            transactions: [
                {
                    to: factoryAddress,
                    value: "0",
                    data: factoryInterface.encodeFunctionData("setTokenAllowed", [usdcAddress, true]),
                    contractMethod: {
                        inputs: [
                            { name: "token", type: "address" },
                            { name: "allowed", type: "bool" }
                        ],
                        name: "setTokenAllowed",
                        payable: false
                    },
                    contractInputsValues: {
                        token: usdcAddress,
                        allowed: "true"
                    }
                },
                {
                    to: factoryAddress,
                    value: "0",
                    data: factoryInterface.encodeFunctionData("setTokenAllowed", [wethAddress, true]),
                    contractMethod: {
                        inputs: [
                            { name: "token", type: "address" },
                            { name: "allowed", type: "bool" }
                        ],
                        name: "setTokenAllowed",
                        payable: false
                    },
                    contractInputsValues: {
                        token: wethAddress,
                        allowed: "true"
                    }
                },
                {
                    to: factoryAddress,
                    value: "0",
                    data: factoryInterface.encodeFunctionData("setTokenAllowed", [clonesAddress, true]),
                    contractMethod: {
                        inputs: [
                            { name: "token", type: "address" },
                            { name: "allowed", type: "bool" }
                        ],
                        name: "setTokenAllowed",
                        payable: false
                    },
                    contractInputsValues: {
                        token: clonesAddress,
                        allowed: "true"
                    }
                },
                {
                    to: claimRouterAddress,
                    value: "0",
                    data: claimRouterInterface.encodeFunctionData("setFactoryApproved", [factoryAddress, true]),
                    contractMethod: {
                        inputs: [
                            { name: "factory", type: "address" },
                            { name: "approved", type: "bool" }
                        ],
                        name: "setFactoryApproved",
                        payable: false
                    },
                    contractInputsValues: {
                        factory: factoryAddress,
                        approved: "true"
                    }
                }
            ]
        };

        // Step 5: Wait for configuration instructions
        console.log("\n⚠️  STEP 5: MANUAL GOVERNANCE CONFIGURATION REQUIRED");
        console.log("═".repeat(80));
        console.log("🏛️  The following configuration requires TIMELOCK (Safe multisig) execution:");
        console.log("1. Token allowlist configuration (3 transactions)");
        console.log("2. ClaimRouter factory approval (1 transaction)");
        console.log("");
        console.log("🔐 Safe Address:", timelockAddress);
        console.log("📝 Import the generated batch file into Safe transaction builder");
        console.log("═".repeat(80));

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
        console.log("=".repeat(60));

        // Save deployment info
        const deploymentInfo = {
            network: network.name,
            chainId: chainId,
            timestamp: new Date().toISOString(),
            status: "DEPLOYED_PENDING_GOVERNANCE",
            contracts: {
                implementation: implementationAddress,
                factory: factoryAddress,
                claimRouter: claimRouterAddress,
                tokens: {
                    usdc: usdcAddress,
                    weth: wethAddress,
                    clones: clonesAddress
                }
            },
            config: {
                treasury: treasuryAddress,
                timelock: timelockAddress,
                guardian: guardianAddress,
                publisher: publisherAddress
            },
            governanceRequired: {
                safeAddress: timelockAddress,
                batchFile: `./deployments/safe-batch-${chainId}-config.json`,
                instructions: [
                    "1. Import safe-batch-config.json into Safe transaction builder",
                    "2. Review and propose the 4 transactions",
                    "3. Get required signatures from Safe owners", 
                    "4. Execute the batch transaction",
                    "5. Run test-system-functionality.ts to verify"
                ]
            },
            verification: {
                implementation: `npx hardhat verify --network ${network.name} ${implementationAddress}`,
                factory: `npx hardhat verify --network ${network.name} ${factoryAddress} "${implementationAddress}" "${treasuryAddress}" "${timelockAddress}" "${guardianAddress}" "${publisherAddress}"`,
                claimRouter: `npx hardhat verify --network ${network.name} ${claimRouterAddress} "${timelockAddress}"`
            }
        };

        const fs = require("fs");
        const deploymentPath = `./deployments/${network.name}-${chainId}-safe.json`;
        const safeBatchPath = `./deployments/safe-batch-${chainId}-config.json`;
        
        fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
        fs.writeFileSync(safeBatchPath, JSON.stringify(safeBatch, null, 2));
        
        console.log(`💾 Deployment info saved to ${deploymentPath}`);
        console.log(`💾 Safe batch file saved to ${safeBatchPath}`);

        console.log("\n🎉 Deployment Phase 1 COMPLETED!");
        console.log("\n📋 NEXT STEPS:");
        console.log("1. 📝 Verify contracts on Basescan:");
        console.log(`   ${deploymentInfo.verification.implementation}`);
        console.log(`   ${deploymentInfo.verification.factory}`);
        console.log(`   ${deploymentInfo.verification.claimRouter}`);
        console.log("\n2. 🏛️  Execute governance configuration:");
        console.log(`   - Safe Address: ${timelockAddress}`);
        console.log(`   - Import file: ${safeBatchPath}`);
        console.log(`   - Execute 4 transactions in Safe`);
        console.log("\n3. ✅ Verify system functionality:");
        console.log(`   npx hardhat run scripts/test-system-functionality.ts --network ${network.name}`);

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