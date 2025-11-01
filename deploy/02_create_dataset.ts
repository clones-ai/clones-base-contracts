import { ethers } from "hardhat";
import { pinJson } from "./helpers/ipfs";

async function main() {
  const factoryAddr = process.env.FACTORY!;
  const creatorFee = (await ethers.getSigners())[0].address; // creator gets volume fee locally
  const Factory = await ethers.getContractAt("DatasetFactory", factoryAddr);

  // Sample dataset (metadata merged off-chain later)
  const meta = {
    id: "dataset-001",
    slug: "computer-vision-image-classification",
    name: "Computer Vision Image Classification",
    description:
      "A comprehensive dataset of 2.1M high-quality images across 1000 classes for image classification tasks. Perfect for training state-of-the-art computer vision models.",
    category: "Computer Vision",
    size: 2300000000,
    format: "JPEG, PNG",
    provider: { id: "provider-001", name: "AI Research Lab", avatar: "/green-bot.png" },
    metadata: {
      tags: ["computer-vision", "image-classification", "machine-learning", "deep-learning"],
      license: "Commercial",
      quality: 95,
      samples: 2100000,
      features: ["RGB Images", "1000 Classes", "High Resolution", "Balanced Dataset"],
      previewUrl: "/api/datasets/dataset-001/preview",
      thumbnailUrl: "/clones-logo-purple.svg",
    },
    createdAt: "2024-01-15T10:30:00Z",
    updatedAt: "2024-01-20T14:22:00Z",
    owner: creatorFee,
  };

  const cid = await pinJson(meta); // stubbed CID for local

  // Use 6 decimals supply (prod = 1B*1e6; here we use smaller for easy testing)
  const totalSupply = BigInt(1_000_000 * 1_000_000);
  const burnThreshold = (totalSupply * 5n) / 100n; // 5%
  const vEth = ethers.parseEther("100");          
  const vTok = BigInt(1_000_000 * 1_000_000);
  const seedToCurve = BigInt(800_000 * 1_000_000);

  const params = {
    id: meta.id,
    slug: meta.slug,
    name: meta.name,
    symbol: "DATA-CVIC",
    metadataCID: cid,
    providerId: meta.provider.id,
    qualityCID: "bafy-quality-cid",
    totalSupply,
    burnThreshold,
    vEth,
    vTok,
    seedToCurve,                  // recorded for off-chain scripts (factory doesn’t use it directly)
    targetMcUsdScaled: 400n * 10n ** 8n, // not used until graduation
    creatorFeeRecipient: creatorFee,
    router: ethers.ZeroAddress,   // not needed on localhost until graduation
  } as const;

  const tx = await Factory.launchDataset(params, { value: ethers.parseEther("0.02") });
  const rc = await tx.wait();
  console.log("Launched tx:", rc?.hash);

  // Extract addresses from events/mappings
  const tokenAddr = await (async () => {
    // Factory maps id->token; reuse it here for reliability
    const key = ethers.keccak256(ethers.toUtf8Bytes(meta.id));
    // @ts-ignore – tokenOf is public mapping; call via iface
    const raw = await ethers.provider.call({
      to: factoryAddr, data: new ethers.Interface([
        "function tokenOf(bytes32) view returns (address)"
      ]).encodeFunctionData("tokenOf", [key])
    });
    return new ethers.Interface(["function tokenOf(bytes32) view returns (address)"])
      .decodeFunctionResult("tokenOf", raw)[0] as string;
  })();

  // poolOf(token)
  const poolAddr = await (async () => {
    const raw = await ethers.provider.call({
      to: factoryAddr, data: new ethers.Interface([
        "function poolOf(address) view returns (address)"
      ]).encodeFunctionData("poolOf", [tokenAddr])
    });
    return new ethers.Interface(["function poolOf(address) view returns (address)"])
      .decodeFunctionResult("poolOf", raw)[0] as string;
  })();

  console.log("Token:", tokenAddr);
  console.log("Pool :", poolAddr);

  // Approve + seed pool with tokens from creator
  const token = await ethers.getContractAt("DatasetToken", tokenAddr);
  await (await token.approve(poolAddr, seedToCurve)).wait();

  const pool = await ethers.getContractAt("BondingCurvePool", poolAddr);
  await (await pool.seedTokens(seedToCurve)).wait();
  console.log("✅ Seeded pool with", seedToCurve.toString(), "tokens");
}

main().catch((e) => { console.error(e); process.exit(1); });
