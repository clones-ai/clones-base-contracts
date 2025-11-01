import { ethers } from "hardhat";

async function main() {
  const factoryAddr = process.env.FACTORY!;
  const f = await ethers.getContractAt("DatasetFactory", factoryAddr);
  const key = ethers.keccak256(ethers.toUtf8Bytes("DATA-ECCS"));
  const tx = await f.graduate(key);
  await tx.wait();
  console.log("Graduated.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
