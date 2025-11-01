// hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import * as dotenv from "dotenv";
dotenv.config();

const PK = (process.env.DEPLOYER_KEY || "").trim();
const isValidPk = /^0x[0-9a-fA-F]{64}$/.test(PK);

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.21",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {},
    localhost: {
      url: process.env.RPC_LOCAL || "http://127.0.0.1:8545",
      // no accounts: [] so we use unlocked local accounts
    },
    baseSepolia: {
      url: process.env.RPC_BASE_SEPOLIA || "https://sepolia.base.org",
      accounts: isValidPk ? [PK] : [],
    },
    base: {
      url: process.env.RPC_BASE || "https://mainnet.base.org",
      accounts: isValidPk ? [PK] : [],
    },
  }
};
export default config;
