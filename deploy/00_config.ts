export const CONFIG = {
  targetMcUsdScaled: BigInt(69_000 * 1e8), // if oracle has 8 decimals
  vEth: BigInt(1_300_000_000_000_000_000n), // ~1.3 ETH
  vTok: BigInt(1_073_000_000n * 1_000_000n),
  totalSupply: BigInt(1_000_000_000n * 1_000_000n),
  seedToCurve: BigInt(793_100_000n * 1_000_000n),
  reservedForLP: BigInt(206_900_000n * 1_000_000n),
  burnThreshold: BigInt(50_000_000n * 1_000_000n),
  launchFeeClonesUSD: 50, // off-chain; you’ll charge in $CLONES UI
};
