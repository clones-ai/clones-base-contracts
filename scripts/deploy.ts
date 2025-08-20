import { ethers, network } from "hardhat";
import { parseArgs, readRegistry, writeRegistry } from "./utils";

async function main() {
    // Use environment variables to avoid Hardhat argument parsing conflicts
    const contractName = process.env.CONTRACT_NAME;
    if (!contractName) throw new Error("Usage: CONTRACT_NAME=<Name> hardhat run scripts/deploy.ts --network <net>");

    const argsRaw = process.env.CONTRACT_ARGS; // JSON array string or path to json
    const libsRaw = process.env.CONTRACT_LIBS; // JSON object string
    const saveAs = process.env.CONTRACT_SAVE_AS || contractName;

    const ctorArgs = await parseArgs(argsRaw);
    const libs = libsRaw ? JSON.parse(libsRaw) : undefined;

    console.log(`[deploy] network: ${network.name}`);
    console.log(`[deploy] contract: ${contractName}`);
    if (ctorArgs.length) console.log(`[deploy] args: ${JSON.stringify(ctorArgs)}`);
    if (libs) console.log(`[deploy] libs: ${JSON.stringify(libs)}`);

    const Factory = await ethers.getContractFactory(contractName, { libraries: libs });
    const contract = await Factory.deploy(...ctorArgs);
    const receipt = await contract.deploymentTransaction()?.wait();
    const address = await contract.getAddress();

    console.log(`[deploy] address: ${address}`);
    console.log(`[deploy] tx: ${receipt?.hash}`);

    // Registry update
    const reg = await readRegistry(network.name);
    reg.contracts[saveAs] = { address, args: ctorArgs, txHash: receipt?.hash };
    await writeRegistry(network.name, reg);

    // Verification helper
    console.log(`[verify] npm run verify -- ${address} '${JSON.stringify(ctorArgs)}'`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
