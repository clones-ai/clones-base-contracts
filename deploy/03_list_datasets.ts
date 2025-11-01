import { ethers } from "hardhat";

function num(x: bigint | number | string) {
  return Number(x);
}

async function main() {
  const registryAddr = process.env.REGISTRY!;
  const factoryAddr = process.env.FACTORY!;

  const Registry = await ethers.getContractAt("DatasetRegistry", registryAddr);
  const Factory = await ethers.getContractAt("DatasetFactory", factoryAddr);

  const total = await Registry.getCount();
  const page = await Registry.getRange(0, Number(total));

  const out: any[] = [];
  for (const e of page) {
    const bc = await Factory.getBondingCurve(e.token, 400); // graduationThreshold demo value
    // Shape sample JSON (metadata fields come from IPFS/DB in real API)
    out.push({
      id: e.id,
      slug: e.slug,
      name: "—",
      description: "—",
      category: "—",
      size: 0,
      format: "",
      price: Number(bc.currentPrice) / 1e18,
      tokenAddress: e.token,
      bondingCurve: {
        currentPrice: Number(bc.currentPrice) / 1e18,
        totalSupply: num(bc.totalSupply),
        virtualEthReserve: num(bc.virtualEthReserve),
        virtualTokenReserve: num(bc.virtualTokenReserve),
        k: num(bc.k),
        isGraduated: bc.isGraduated,
        graduationThreshold: num(bc.graduationThreshold),
      },
      metadata: {
        tags: [],
        license: "Commercial",
        quality: 0,
        samples: 0,
        features: [],
        previewUrl: `/api/datasets/${e.id}/preview`,
        thumbnailUrl: "/clones-logo-purple.svg",
      },
      provider: { id: e.providerId, name: "—", avatar: "/green-bot.png" },
      createdAt: new Date(Number(e.createdAt) * 1000).toISOString(),
      updatedAt: new Date(Number(e.updatedAt) * 1000).toISOString(),
      owner: e.creator,
      isGraduated: bc.isGraduated,
      totalSupply: num(bc.totalSupply),
      currentPrice: Number(bc.currentPrice) / 1e18,
      volume24h: 0,
      marketCap: 0,
      rating: 0,
      reviewCount: 0,
    });
  }

  console.log(
    JSON.stringify(
      {
        data: out,
        pagination: {
          page: 1,
          limit: out.length,
          total: out.length,
          totalPages: 1,
        },
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
