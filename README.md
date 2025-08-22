# Clones Base Contracts

This repository contains the official smart contracts for the Clones protocol on the Base L2 network. The project is structured to support multiple, independent contracts that work together to form the Clones ecosystem.

This project is built with **Hardhat**, **Ethers.js v6**, and **OpenZeppelin Contracts v5 (Upgradeable)**.

---

## Project Architecture & Standards

This repository is designed as a multi-contract workspace. All contracts developed herein adhere to a common set of high-quality standards to ensure security, maintainability, and efficiency.

### Core Principles
- **Security First:** Contracts are developed with a defense-in-depth mindset, incorporating protections against common vulnerabilities (reentrancy, access control failures), L2-specific risks, and economic exploits.
- **Gas Optimization:** We prioritize gas efficiency for frequently called functions by using modern Solidity patterns like custom errors, storage pointers, and optimized data structures.
- **Upgradeable by Default:** Major stateful contracts are built using the UUPS proxy pattern to allow for seamless future upgrades.
- **Clarity & Maintainability:** Code is written to be clear, well-documented with NatSpec, and thoroughly tested.

---

## Project Contracts

This section provides an overview of the individual smart contracts within the Clones ecosystem.

### 1. RewardPool

The `RewardPool` is a central contract designed to aggregate rewards from multiple sources (factories) and allow users (farmers) to withdraw them securely and efficiently.

#### Key Features:
- **Configurable:** Core parameters (fees, treasury, cooldowns) are managed via a `PoolConfig` struct.
- **Role-Based Access:** Uses `AccessControlEnumerable` for transparent, on-chain management of roles.
- **L2-Aware:** Includes a built-in, configurable check for sequencer uptime on Base.
- **Robust Security:** Features reentrancy protection, nonce-based withdrawals, rate limiting, fee-on-transfer token rejection, and more.
- **Safe Fee Collection:** Buffers protocol fees to prevent withdrawals from failing due to an incompatible treasury.

*(As new contracts are added to the project, they will be documented here.)*

---

## Development & Deployment

### Environment Setup

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Configure Environment:**
   Create a `.env` file in the project root by copying `.env.example`. Fill in the required variables:
   ```env
   PRIVATE_KEY=your_wallet_private_key
   BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
   ETHERSCAN_API_KEY=your_etherscan_v2_api_key
   ```
   **Note:** Never commit your `.env` file.

### Testing

Run the full test suite for all contracts:
```bash
npx hardhat test
```

### Available Commands

The project includes several npm scripts for common operations:

#### **Deployment Commands:**
- `npm run deploy:baseSepolia` - Deploy standard contracts to Base Sepolia testnet
- `npm run deploy:base` - Deploy standard contracts to Base mainnet
- `npm run deploy:upgradeable:baseSepolia` - Deploy upgradeable contracts to Base Sepolia testnet
- `npm run deploy:upgradeable:base` - Deploy upgradeable contracts to Base mainnet

#### **Other Commands:**
- `npm run build` - Compile contracts
- `npm run test` - Run tests
- `npm run coverage` - Generate test coverage report
- `npm run lint:sol` - Lint Solidity code

### Deployment Guide

The deployment process is managed via scripts in the `scripts/` directory and is designed to be generic.

**You can deploy contracts using environment variables without modifying the deployment scripts.**

#### **Standard Contracts vs Upgradeable Contracts**

This project supports two types of contracts:

1. **Standard Contracts** - Use `scripts/deploy.ts`
2. **Upgradeable Contracts** (like `RewardPool`) - Use `scripts/deploy-upgradeable.ts`

#### **Example: Deploying RewardPool (Upgradeable Contract) on Base Sepolia**

The `RewardPool` contract is an upgradeable contract that uses the UUPS pattern. Here's how to deploy it:

1. **Configure Environment Variables:**
   Set the following environment variables in your `.env` file or export them in your terminal:
   ```bash
   export CONTRACT_NAME="RewardPool"
   export CONTRACT_ARGS='["0xADMIN_ADDRESS", "0xTREASURY_ADDRESS", 1000, "0xBASE_SEPOLIA_SEQUENCER_FEED"]'
   export CONTRACT_SAVE_AS="RewardPool"  # Optional: custom name for registry
   ```
   
   Or add them to your `.env` file:
   ```env
   CONTRACT_NAME=RewardPool
   CONTRACT_ARGS=["0xADMIN_ADDRESS", "0xTREASURY_ADDRESS", 1000, "0xBASE_SEPOLIA_SEQUENCER_FEED"]
   CONTRACT_SAVE_AS=RewardPool
   ```

2. **Run the Deployment:**
   **For upgradeable contracts like RewardPool, use:**
   ```bash
   npm run deploy:upgradeable:baseSepolia
   ```
   
   **For standard contracts, use:**
   ```bash
   npm run deploy:baseSepolia
   ```
   
   The script will deploy the contract and log both the proxy and implementation addresses to the console.

3. **Verify on Basescan:**
   **For upgradeable contracts (like RewardPool):**
   - Verify the **implementation address** (not the proxy address)
   - The implementation address is logged during deployment
   ```bash
   npx hardhat verify --network baseSepolia <IMPLEMENTATION_ADDRESS>
   ```
   
   **For standard contracts:**
   - Verify the deployed contract address directly
   ```bash
   npx hardhat verify --network baseSepolia <DEPLOYED_CONTRACT_ADDRESS>
   ```
   
   The verification process for UUPS proxies is handled by the `@openzeppelin/hardhat-upgrades` plugin.

4. **Post-Deployment:**
   After deployment, use a tool like Etherscan or a custom script to perform necessary post-deployment actions, such as granting roles (`grantRole`) to the appropriate addresses.
