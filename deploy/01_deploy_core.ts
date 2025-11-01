import { ethers } from "hardhat";
import { isAddress, ZeroAddress } from "ethers";

function pickAddress(name: string, env?: string, fallback?: string) {
  const v = (env || "").trim();
  if (v && isAddress(v)) return v;
  if (fallback && isAddress(fallback)) return fallback;
  throw new Error(`Invalid ${name}. Set a checksum address in .env`);
}

async function main() {
  const [deployer] = await ethers.getSigners();

  const network = await ethers.provider.getNetwork();
  const isLocal = network.chainId === 31337n;

  // ---- Oracle address (use mock on localhost) ----
  let oracleAddr: string;
  if (isLocal) {
    const Mock = await ethers.getContractFactory("MockAggregator");
    // 3000.00 * 1e8 (Chainlink typical 8 decimals)
    const mock = await Mock.deploy(3000_00_000_00n, 8);
    await mock.waitForDeployment();
    oracleAddr = await mock.getAddress();
    console.log("Mock Oracle  :", oracleAddr);
  } else {
    const envOracle =
      process.env.CHAINLINK_ETH_USD_BASE_SEPOLIA ||
      process.env.CHAINLINK_ETH_USD_BASE;
    if (!envOracle)
      throw new Error("Set CHAINLINK_ETH_USD_BASE[_SEPOLIA] in .env");
    if (!isAddress(envOracle))
      throw new Error("CHAINLINK_ETH_USD_* must be a valid address");
    oracleAddr = envOracle;
  }

  // ---- Fee recipients (default to deployer on localhost) ----
  const protocolFee = isLocal
    ? await deployer.getAddress()
    : pickAddress(
        "PROTOCOL_FEE_RECIPIENT",
        process.env.PROTOCOL_FEE_RECIPIENT,
        undefined
      );

  // Deploy Registry
  const Registry = await ethers.getContractFactory("DatasetRegistry");
  const reg = await Registry.deploy();
  await reg.waitForDeployment();
  const regAddr = await reg.getAddress();
  console.log("Registry     :", regAddr);

  // Deploy Factory
  const Factory = await ethers.getContractFactory("DatasetFactory");
  const fac = await Factory.deploy(oracleAddr, protocolFee, regAddr);
  await fac.waitForDeployment();
  const facAddr = await fac.getAddress();
  console.log("Factory      :", facAddr);
  // after deploying Factory:
  await (await reg.transferOwnership(await fac.getAddress())).wait();
  console.log("Registry owner -> Factory");

  // Deploy BurnPortal & wire to Factory
  const Burn = await ethers.getContractFactory("BurnPortal");
  const burn = await Burn.deploy();
  await burn.waitForDeployment();
  const burnAddr = await burn.getAddress();
  console.log("BurnPortal   :", burnAddr);

  await (await burn.setFactory(facAddr)).wait();
  await (await fac.setBurnPortal(burnAddr)).wait();

  // Optional ownership transfers — only if valid addresses were provided
  const regOwner = (process.env.REGISTRY_OWNER || "").trim();
  if (
    isAddress(regOwner) &&
    regOwner.toLowerCase() !== (await deployer.getAddress()).toLowerCase()
  ) {
    await (await reg.transferOwnership(regOwner)).wait();
    console.log("Registry owner set ->", regOwner);
  }
  const portalOwner = (process.env.BURN_PORTAL_OWNER || "").trim();
  if (
    isAddress(portalOwner) &&
    portalOwner.toLowerCase() !== (await deployer.getAddress()).toLowerCase()
  ) {
    await (await burn.transferOwnership(portalOwner)).wait();
    console.log("BurnPortal owner set ->", portalOwner);
  }

  console.log("✅ Core deployed.");
  console.log(
    JSON.stringify(
      { REGISTRY: regAddr, FACTORY: facAddr, BURN_PORTAL: burnAddr },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
