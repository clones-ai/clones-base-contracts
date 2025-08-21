import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";

// Core plugins (Hardhat 2.x)
import "@nomicfoundation/hardhat-ethers";   // Ethers v6 adapter
import "@nomicfoundation/hardhat-verify";   // Verify v2 (Etherscan-compatible)
import "@nomicfoundation/hardhat-chai-matchers";
import "hardhat-gas-reporter";
import "@openzeppelin/hardhat-upgrades";
import "@typechain/hardhat";
import "solidity-coverage";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const BASESCAN_KEY = process.env.BASESCAN_KEY || ""; // basescan.org API key

const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.30",
        settings: {
            optimizer: { enabled: true, runs: 600 }
        }
    },

    networks: {
        // Base Mainnet — official public RPC (rate-limited). For production, prefer a dedicated provider.
        // Docs: chainId 8453, RPC https://mainnet.base.org
        base: {
            chainId: 8453,
            url: process.env.BASE_RPC_URL || "https://mainnet.base.org",
            accounts: PRIVATE_KEY ? [PRIVATE_KEY] : []
        },

        // Base Sepolia (Testnet) — official public RPC (rate-limited).
        // Docs: chainId 84532, RPC https://sepolia.base.org
        baseSepolia: {
            chainId: 84532,
            url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
            accounts: PRIVATE_KEY ? [PRIVATE_KEY] : []
        }
    },

    etherscan: {
        apiKey: {
            base: BASESCAN_KEY,
            baseSepolia: BASESCAN_KEY
        },
        customChains: [
            {
                network: "base",
                chainId: 8453,
                urls: {
                    apiURL: "https://api.basescan.org/api",
                    browserURL: "https://basescan.org"
                }
            },
            {
                network: "baseSepolia",
                chainId: 84532,
                urls: {
                    apiURL: "https://api-sepolia.basescan.org/api",
                    browserURL: "https://sepolia.basescan.org"
                }
            }
        ]
    },

    typechain: {
        outDir: "typechain-types",
        target: "ethers-v6",
    },

    sourcify: {
        enabled: true
    },

    gasReporter: {
        enabled: process.env.REPORT_GAS === "true",
        currency: "USD",
        coinmarketcap: process.env.CMC_KEY
    }
};

export default config;
