import { ethers, upgrades, network } from "hardhat";
import { parseArgs, readRegistry, writeRegistry } from "./utils";

async function main() {
    // Use environment variables to avoid Hardhat argument parsing conflicts
    const contractName = process.env.CONTRACT_NAME;
    if (!contractName) throw new Error("Usage: CONTRACT_NAME=<Name> hardhat run scripts/deploy-upgradeable.ts --network <net>");

    const argsRaw = process.env.CONTRACT_ARGS; // JSON array string for initialize function
    const saveAs = process.env.CONTRACT_SAVE_AS || contractName;

    const initArgs = await parseArgs(argsRaw);

    console.log(`[deploy] network: ${network.name}`);
    console.log(`[deploy] contract: ${contractName}`);
    if (initArgs.length) console.log(`[deploy] init args: ${JSON.stringify(initArgs)}`);

    // Deploy the upgradeable contract
    const Factory = await ethers.getContractFactory(contractName);

    console.log(`[deploy] deploying upgradeable contract...`);
    const contract = await upgrades.deployProxy(Factory, initArgs, {
        kind: 'uups',
        initializer: 'initialize'
    });

    await contract.waitForDeployment();
    console.log(`[deploy] contract deployed, waiting for confirmation...`);

    // Wait for a few blocks to be mined to allow the transaction to propagate
    // This is often necessary on L2s or testnets with slower finality
    const waitTime = 15; // seconds
    await new Promise(resolve => setTimeout(resolve, waitTime * 1000));

    const address = await contract.getAddress();

    // Get implementation address
    const implAddress = await upgrades.erc1967.getImplementationAddress(address);

    console.log(`[deploy] proxy address: ${address}`);
    console.log(`[deploy] implementation address: ${implAddress}`);

    // Registry update
    const reg = await readRegistry(network.name);
    reg.contracts[saveAs] = {
        address,
        impl: implAddress,
        args: initArgs,
        type: 'upgradeable'
    };
    await writeRegistry(network.name, reg);

    // Verification helper
    console.log(`[verify] command: npx hardhat verify --network ${network.name} ${implAddress}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
