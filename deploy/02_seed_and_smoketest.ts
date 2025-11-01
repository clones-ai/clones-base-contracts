import { ethers } from "hardhat";

async function main() {
  const factoryAddr = process.env.FACTORY!;
  const id = "dataset-001";

  // Lookup token + pool from factory mappings
  const key = ethers.keccak256(ethers.toUtf8Bytes(id));
  const factory = await ethers.getContractAt("DatasetFactory", factoryAddr);
  // @ts-ignore
  const tokenAddr: string = await (factory as any).tokenOf(key);
  // @ts-ignore
  const poolAddr: string = await (factory as any).poolOf(tokenAddr);

  const pool = await ethers.getContractAt("BondingCurvePool", poolAddr);
  const token = await ethers.getContractAt("DatasetToken", tokenAddr);
  const [buyer] = await ethers.getSigners();

  console.log("Buyer     :", buyer.address);
  console.log("Pool      :", poolAddr);
  console.log("Token     :", tokenAddr);

  // Buy 0.5 ETH worth
  const tx = await pool.connect(buyer).buy({ value: ethers.parseEther("0.5") });
  await tx.wait();

  const bal = await token.balanceOf(buyer.address);
  const price = await pool.currentPriceEthPerToken();
  console.log("Buyer token balance:", bal.toString());
  console.log("Current price (ETH per token, 1e18):", price.toString());
  console.log("✅ Buy smoke test passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
