# Clones Base Contracts

This repository contains the official smart contracts for the Clones protocol on the Base L2 network. The project implements a factory-based reward pool system using EIP-1167 minimal proxy pattern for efficient deployment of individual reward pools.

This project is built with **Hardhat**, **Ethers.js v6**, and **OpenZeppelin Contracts v5**.

---

## Project Architecture & Standards

This repository implements a modern factory-based architecture for reward pool management. All contracts adhere to high-quality standards ensuring security, gas efficiency, and maintainability.

### Core Principles
- **Security First:** Defense-in-depth approach with reentrancy protection, access control, and L2-specific safety features.
- **Gas Optimization:** EIP-1167 minimal proxy pattern reduces deployment costs by 99%+ compared to full contract deployments.
- **Deterministic Addresses:** CREATE2 implementation allows prediction of pool addresses before deployment.
- **Batch Operations:** ClaimRouter enables efficient multi-vault reward claiming in a single transaction.
- **EIP-712 Signatures:** Secure, off-chain signed reward claims with replay protection.

---

## Project Contracts

This section provides an overview of the smart contracts within the Phase 1 factory system.

### 1. RewardPoolFactory

The `RewardPoolFactory` is the core factory contract that creates deterministic reward pools using EIP-1167 minimal proxy pattern.

#### Key Features:
- **EIP-1167 Clones:** Deploys lightweight proxy contracts (CREATE2) pointing to a master implementation
- **Deterministic Addresses:** Pool addresses are predictable using creator + token combination
- **Token Allowlist:** Only approved tokens can be used for pool creation
- **Publisher Management:** Role-based system for authorized reward publishers
- **Minimal Gas Cost:** ~50k gas per pool creation vs ~2M gas for full deployment

### 2. RewardPoolImplementation

The `RewardPoolImplementation` serves as the master contract containing all pool logic that is shared by minimal proxies.

#### Key Features:
- **EIP-712 Signatures:** Secure reward claiming with typed data signatures
- **Cumulative Rewards:** Prevents double-spending with cumulative reward tracking
- **Factory Integration:** Validates that calls originate from approved factories
- **Fee Collection:** Transparent 10% platform fee on all reward claims
- **Deadline Protection:** Time-limited signatures prevent stale claim attempts

### 3. ClaimRouter

The `ClaimRouter` enables efficient batch claiming across multiple reward pools in a single transaction.

#### Key Features:
- **Multi-Vault Batching:** Claim rewards from multiple pools atomically
- **Gas Optimization:** Reduces transaction costs for users with multiple active pools
- **Factory Verification:** Only processes claims from approved factory-created pools
- **Batch Size Limits:** Configurable limits prevent gas exhaustion attacks
- **Atomic Operations:** All claims succeed or fail together

---

## Architecture Benefits

### Phase 1 Factory System
The current Phase 1 implementation provides:

1. **Cost Efficiency**: 99%+ reduction in pool deployment costs via EIP-1167
2. **Scalability**: Support for unlimited independent reward pools
3. **Predictability**: Deterministic addresses enable off-chain integrations
4. **Security**: EIP-712 signatures with replay protection
5. **User Experience**: Batch claiming reduces transaction overhead

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
- `npm run deploy:baseSepolia` - Deploy individual contracts to Base Sepolia testnet
- `npm run deploy:base` - Deploy individual contracts to Base mainnet  
- `npm run deploy-factory-system:baseSepolia` - Deploy complete factory system to Base Sepolia testnet
- `npm run deploy-factory-system:base` - Deploy complete factory system to Base mainnet
- `npm run deploy-and-test:baseSepolia` - Deploy + run integration tests on Base Sepolia
- `npm run final-validation:baseSepolia` - Validate deployed system functionality

#### **Other Commands:**
- `npm run build` - Compile contracts
- `npm run test` - Run tests
- `npm run coverage` - Generate test coverage report
- `npm run lint:sol` - Lint Solidity code

### Deployment Guide

The deployment process is managed via scripts in the `scripts/` directory and is designed to be generic.

**You can deploy contracts using environment variables without modifying the deployment scripts.**

#### **Factory System Architecture**

The Phase 1 factory system uses standard (non-upgradeable) contracts:

1. **Implementation Contract** - Master logic contract deployed once
2. **Factory Contract** - Creates minimal proxies pointing to implementation  
3. **ClaimRouter Contract** - Handles batch operations across multiple pools

This approach eliminates the need for upgradeable patterns while maintaining flexibility through the proxy system.

#### **Example: Deploying Factory System on Base Sepolia**

The factory system consists of standard contracts (no upgrades needed due to EIP-1167 pattern). Here's how to deploy the complete system:

1. **Deploy RewardPoolImplementation (Master Contract):**
   ```bash
   export CONTRACT_NAME="RewardPoolImplementation"
   export CONTRACT_ARGS='[]'  # No constructor arguments
   export CONTRACT_SAVE_AS="RewardPoolImplementation"
   npm run deploy:baseSepolia
   ```

2. **Deploy RewardPoolFactory:**
   ```bash
   export CONTRACT_NAME="RewardPoolFactory"  
   export CONTRACT_ARGS='["<IMPLEMENTATION_ADDRESS>", "0xADMIN_ADDRESS"]'
   export CONTRACT_SAVE_AS="RewardPoolFactory"
   npm run deploy:baseSepolia
   ```

3. **Deploy ClaimRouter:**
   ```bash
   export CONTRACT_NAME="ClaimRouter"
   export CONTRACT_ARGS='["0xADMIN_ADDRESS"]'
   export CONTRACT_SAVE_AS="ClaimRouter" 
   npm run deploy:baseSepolia
   ```

4. **Complete System Deployment (Recommended):**
   Use the factory deployment script for automated setup:
   ```bash
   npm run deploy-factory-system:baseSepolia
   ```

5. **Verify Contracts:**
   ```bash
   # Verify Implementation
   npx hardhat verify --network baseSepolia <IMPLEMENTATION_ADDRESS>
   
   # Verify Factory
   npx hardhat verify --network baseSepolia <FACTORY_ADDRESS> "<IMPLEMENTATION_ADDRESS>" "0xADMIN_ADDRESS"
   
   # Verify ClaimRouter
   npx hardhat verify --network baseSepolia <CLAIM_ROUTER_ADDRESS> "0xADMIN_ADDRESS"
   ```

6. **Post-Deployment Testing & Validation:**
   ```bash
   # Run integration tests after deployment
   npm run deploy-and-test:baseSepolia
   
   # Validate system functionality  
   npm run final-validation:baseSepolia
   ```

7. **Available Scripts:**
   - **`deploy-factory-system`** - Complete factory deployment with configuration
   - **`deploy-and-test`** - Deploy + integration tests + gas benchmarks
   - **`final-validation`** - CREATE2 validation + end-to-end testing
   - **`verify`** - Contract verification on block explorers
