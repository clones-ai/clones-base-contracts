import { ethers } from "hardhat";

/**
 * Generate transaction calldata for Safe multisig execution
 * Outputs the exact transactions that need to be proposed in Safe
 */
async function main() {
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);

    console.log("🔐 Generating Safe Multisig Transactions");
    console.log("Network:", network.name);
    console.log("Chain ID:", chainId);

    // Contract addresses
    const FACTORY_ADDRESS = "0xda704A5bAC54FfE3A56D3B48a7EF6f3279557829";
    const CLAIM_ROUTER_ADDRESS = "0x3cF83B17163681d48B5fdd926eFcDA9940cB49fc";
    const TIMELOCK_ADDRESS = "0x1320b33b21dD4F79735d8555eE49C6650eacc271";

    // Token addresses
    const MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const MAINNET_WETH = "0x4200000000000000000000000000000000000006";
    const MAINNET_CLONES = "0xaadd98Ad4660008C917C6FE7286Bc54b2eEF894d";

    console.log("\n📋 Safe Configuration for:");
    console.log("Safe Address (Timelock):", TIMELOCK_ADDRESS);
    console.log("Factory:", FACTORY_ADDRESS);
    console.log("ClaimRouter:", CLAIM_ROUTER_ADDRESS);

    // Get contract interfaces for calldata generation
    const factoryInterface = new ethers.Interface([
        "function setTokenAllowed(address token, bool allowed) external"
    ]);
    
    const claimRouterInterface = new ethers.Interface([
        "function setFactoryApproved(address factory, bool approved) external"
    ]);

    console.log("\n🔧 SAFE TRANSACTIONS TO PROPOSE:");
    console.log("=" .repeat(80));

    // Transaction 1: Approve USDC in Factory
    const tx1Data = factoryInterface.encodeFunctionData("setTokenAllowed", [MAINNET_USDC, true]);
    console.log("\n📝 Transaction 1: Approve USDC in Factory");
    console.log("To:", FACTORY_ADDRESS);
    console.log("Value: 0");
    console.log("Data:", tx1Data);

    // Transaction 2: Approve WETH in Factory
    const tx2Data = factoryInterface.encodeFunctionData("setTokenAllowed", [MAINNET_WETH, true]);
    console.log("\n📝 Transaction 2: Approve WETH in Factory");
    console.log("To:", FACTORY_ADDRESS);
    console.log("Value: 0");
    console.log("Data:", tx2Data);

    // Transaction 3: Approve CLONES in Factory
    const tx3Data = factoryInterface.encodeFunctionData("setTokenAllowed", [MAINNET_CLONES, true]);
    console.log("\n📝 Transaction 3: Approve CLONES in Factory");
    console.log("To:", FACTORY_ADDRESS);
    console.log("Value: 0");
    console.log("Data:", tx3Data);

    // Transaction 4: Approve Factory in ClaimRouter
    const tx4Data = claimRouterInterface.encodeFunctionData("setFactoryApproved", [FACTORY_ADDRESS, true]);
    console.log("\n📝 Transaction 4: Approve Factory in ClaimRouter");
    console.log("To:", CLAIM_ROUTER_ADDRESS);
    console.log("Value: 0");
    console.log("Data:", tx4Data);

    console.log("\n=" .repeat(80));

    // Generate Safe batch transaction JSON
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
                to: FACTORY_ADDRESS,
                value: "0",
                data: tx1Data,
                contractMethod: {
                    inputs: [
                        { name: "token", type: "address" },
                        { name: "allowed", type: "bool" }
                    ],
                    name: "setTokenAllowed",
                    payable: false
                },
                contractInputsValues: {
                    token: MAINNET_USDC,
                    allowed: "true"
                }
            },
            {
                to: FACTORY_ADDRESS,
                value: "0",
                data: tx2Data,
                contractMethod: {
                    inputs: [
                        { name: "token", type: "address" },
                        { name: "allowed", type: "bool" }
                    ],
                    name: "setTokenAllowed",
                    payable: false
                },
                contractInputsValues: {
                    token: MAINNET_WETH,
                    allowed: "true"
                }
            },
            {
                to: FACTORY_ADDRESS,
                value: "0",
                data: tx3Data,
                contractMethod: {
                    inputs: [
                        { name: "token", type: "address" },
                        { name: "allowed", type: "bool" }
                    ],
                    name: "setTokenAllowed",
                    payable: false
                },
                contractInputsValues: {
                    token: MAINNET_CLONES,
                    allowed: "true"
                }
            },
            {
                to: CLAIM_ROUTER_ADDRESS,
                value: "0",
                data: tx4Data,
                contractMethod: {
                    inputs: [
                        { name: "factory", type: "address" },
                        { name: "approved", type: "bool" }
                    ],
                    name: "setFactoryApproved",
                    payable: false
                },
                contractInputsValues: {
                    factory: FACTORY_ADDRESS,
                    approved: "true"
                }
            }
        ]
    };

    // Save Safe batch file
    const fs = require("fs");
    const batchPath = `./deployments/safe-batch-${chainId}-config.json`;
    fs.writeFileSync(batchPath, JSON.stringify(safeBatch, null, 2));
    console.log(`💾 Safe batch file saved: ${batchPath}`);

    // Create human-readable summary
    const summary = {
        network: network.name,
        chainId: chainId,
        timestamp: new Date().toISOString(),
        safeAddress: TIMELOCK_ADDRESS,
        transactions: [
            {
                description: "Approve USDC in Factory",
                to: FACTORY_ADDRESS,
                function: "setTokenAllowed",
                parameters: { token: MAINNET_USDC, allowed: true }
            },
            {
                description: "Approve WETH in Factory", 
                to: FACTORY_ADDRESS,
                function: "setTokenAllowed",
                parameters: { token: MAINNET_WETH, allowed: true }
            },
            {
                description: "Approve CLONES in Factory",
                to: FACTORY_ADDRESS, 
                function: "setTokenAllowed",
                parameters: { token: MAINNET_CLONES, allowed: true }
            },
            {
                description: "Approve Factory in ClaimRouter",
                to: CLAIM_ROUTER_ADDRESS,
                function: "setFactoryApproved", 
                parameters: { factory: FACTORY_ADDRESS, approved: true }
            }
        ],
        instructions: [
            "1. Go to Safe web interface",
            "2. Import the batch file or create transactions manually",
            "3. Propose the batch transaction",
            "4. Get required signatures from Safe owners",
            "5. Execute the transaction"
        ]
    };

    const summaryPath = `./deployments/safe-instructions-${chainId}.json`;
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`📋 Instructions saved: ${summaryPath}`);

    console.log("\n🔐 SAFE MULTISIG INSTRUCTIONS:");
    console.log("1. Go to Safe web interface:", `https://app.safe.global/home?safe=${TIMELOCK_ADDRESS}`);
    console.log("2. Create a new transaction batch");
    console.log("3. Add 4 transactions with the data above");
    console.log("4. Or import the batch file:", batchPath);
    console.log("5. Propose, sign, and execute");

    console.log("\n📝 Quick Copy-Paste for Safe UI:");
    console.log("─".repeat(50));
    console.log("Transaction 1:");
    console.log(`To: ${FACTORY_ADDRESS}`);
    console.log(`Data: ${tx1Data}`);
    console.log("─".repeat(50));
    console.log("Transaction 2:");
    console.log(`To: ${FACTORY_ADDRESS}`);
    console.log(`Data: ${tx2Data}`);
    console.log("─".repeat(50));
    console.log("Transaction 3:");
    console.log(`To: ${FACTORY_ADDRESS}`);
    console.log(`Data: ${tx3Data}`);
    console.log("─".repeat(50));
    console.log("Transaction 4:");
    console.log(`To: ${CLAIM_ROUTER_ADDRESS}`);
    console.log(`Data: ${tx4Data}`);
    console.log("─".repeat(50));

    console.log("\n✅ Safe transaction data generated successfully!");
    console.log("🔐 Ready for Safe multisig execution");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Script failed:", error);
        process.exit(1);
    });