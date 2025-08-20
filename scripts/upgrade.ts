import { ethers, upgrades, network } from "hardhat";
import { parseArgs, readRegistry, writeRegistry } from "./utils";

async function main() {
    const proxy = process.env.PROXY_ADDRESS;
    const implName = process.env.IMPL_NAME;
    const kind = (process.env.UPGRADE_KIND as "uups" | "transparent") || "uups";
    const callRaw = process.env.UPGRADE_CALL; // e.g. '["initializeV2", ["param1"]]'
    const saveAs = process.env.SAVE_AS || implName;

    if (!proxy || !implName) {
        throw new Error("Usage: PROXY_ADDRESS=<0x...> IMPL_NAME=<ImplV2> npm run upgrade -- --network <network-name>");
    }

    if (!saveAs) {
        throw new Error("saveAs cannot be undefined, check IMPL_NAME or SAVE_AS");
    }

    const Impl = await ethers.getContractFactory(implName);

    let upgraded;
    if (callRaw) {
        const [fn, params] = await parseArgs(callRaw);
        upgraded = await upgrades.upgradeProxy(proxy, Impl, {
            kind,
            call: { fn, args: params || [] }
        });
    } else {
        upgraded = await upgrades.upgradeProxy(proxy, Impl, { kind });
    }
    await upgraded.waitForDeployment();

    const implAddr = await upgrades.erc1967.getImplementationAddress(proxy);
    console.log(`[upgrade] proxy: ${proxy}`);
    console.log(`[upgrade] new impl: ${implAddr}`);

    // update registry
    const reg = await readRegistry(network.name);
    reg.contracts[saveAs] = { address: proxy, impl: implAddr };
    await writeRegistry(network.name, reg);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
