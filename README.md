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
   ETHERSCAN_API_KEY=your_basescan_api_key
   ```
   **Note:** Never commit your `.env` file.

### Testing

Run the full test suite for all contracts:
```bash
npx hardhat test
```

### Deployment Guide (Example: RewardPool on Base Sepolia)

The deployment process is managed via scripts in the `scripts/` directory and is designed to be generic.

**To deploy a contract, you will need to edit the `scripts/deploy.ts` file to specify which contract you are deploying and its constructor arguments.**

Here is an example workflow for deploying the `RewardPool` contract to the Base Sepolia testnet:

1. **Configure `scripts/deploy.ts`:**
   Modify the script to target the `RewardPool` contract and provide its `initialize` arguments. For example:
   ```typescript
   // In scripts/deploy.ts
   const contractName = "RewardPool";
   const contractArgs = [
       "0xADMIN_ADDRESS",      // admin
       "0xTREASURY_ADDRESS",   // treasury
       1000,                   // feeBps (e.g., 10%)
       "0xBASE_SEPOLIA_SEQUENCER_FEED" // sequencerUptimeFeed
   ];
   ```

2. **Run the Deployment:**
   Execute the deployment script, targeting the `baseSepolia` network:
   ```bash
   npx hardhat run scripts/deploy.ts --network baseSepolia
   ```
   The script will deploy the contract and log its address to the console.

3. **Verify on Basescan:**
   Use the `verify` task with the address output from the previous step. The verification process for UUPS proxies is handled by the `@openzeppelin/hardhat-upgrades` plugin.
   ```bash
   npx hardhat verify --network baseSepolia <DEPLOYED_PROXY_ADDRESS>
   ```

4. **Post-Deployment:**
   After deployment, use a tool like Etherscan or a custom script to perform necessary post-deployment actions, such as granting roles (`grantRole`) to the appropriate addresses.
