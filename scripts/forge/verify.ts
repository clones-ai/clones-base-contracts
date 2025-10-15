import { run, network } from "hardhat";
import { parseArgs, readRegistry } from "./utils";

async function main() {
    const argv = process.argv.slice(2);
    const get = (flag: string) => {
        const i = argv.indexOf(flag);
        return i >= 0 ? argv[i + 1] : undefined;
    };

    const address = get("--address");
    const name = get("--name");
    const argsRaw = get("--args"); // optional
    const networkName = get("--network");

    if (!networkName) {
        throw new Error("Usage: --network <network> is required (e.g., --network baseSepolia)");
    }

    let target = address;
    let args: any[] = [];

    if (!target && !name) {
        throw new Error('Usage: npm run verify -- --address 0x... [--args "[...]"]  OR  --name <RegistryName> [--args "[...]"]');
    }

    if (!target && name) {
        const reg = await readRegistry(networkName);
        const rec = reg.contracts[name];
        if (!rec) throw new Error(`No registry entry "${name}" for network ${networkName}`);
        target = rec.address;
        args = rec.args || [];
    }

    if (argsRaw) {
        args = await parseArgs(argsRaw);
    }

    console.log(`[verify] network: ${networkName}`);
    console.log(`[verify] address: ${target}`);
    console.log(`[verify] args: ${JSON.stringify(args)}`);

    // Since we're running with ts-node, we can't use Hardhat's run command
    // Instead, provide instructions for manual verification
    console.log(`[verify] To verify this contract, run:`);
    console.log(`npx hardhat verify --network ${networkName} ${target} ${args.length > 0 ? JSON.stringify(args) : ''}`);
    console.log(`[verify] done`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
