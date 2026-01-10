# Clones Base Contracts

Official smart contracts for the Clones protocol on the Base L2 network. This repository contains two independent contract systems:

1. **Reward Pool System** - Factory-based reward pools using EIP-1167 minimal proxy pattern
2. **Data Marketplace System** - Tokenized AI training data marketplace with bonding curves

Built with **Hardhat**, **Ethers.js v6**, and **OpenZeppelin Contracts v5**.

[![Tests](https://img.shields.io/badge/tests-150%2F150%20passing-brightgreen)]()
[![Coverage](https://img.shields.io/badge/coverage-83.82%25-green)]()
[![Security](https://img.shields.io/badge/slither-0%20findings-brightgreen)]()
[![Fuzzing](https://img.shields.io/badge/echidna-18%2F18%20invariants-brightgreen)]()
[![Audit Ready](https://img.shields.io/badge/audit-ready-blue)]()


## Contract Systems

### Reward Pool System

Modern factory-based architecture for reward pool management with EIP-1167 minimal proxy pattern.

**Core Principles:**
- **Security First:** Defense-in-depth approach with reentrancy protection, access control, and L2-specific safety features
- **Gas Optimization:** EIP-1167 minimal proxy pattern reduces deployment costs by 99%+ compared to full contract deployments
- **Deterministic Addresses:** CREATE2 implementation allows prediction of pool addresses before deployment
- **Batch Operations:** ClaimRouter enables efficient multi-vault reward claiming in a single transaction
- **EIP-712 Signatures:** Secure, off-chain signed reward claims with replay protection

**Core Contracts:**
- **RewardPoolFactory** - Creates deterministic reward pools using EIP-1167 minimal proxy pattern
- **RewardPoolImplementation** - Master contract containing all pool logic shared by minimal proxies
- **ClaimRouter** - Enables efficient batch claiming across multiple reward pools

### Data Marketplace System

Tokenized AI training data marketplace with bonding curves, burn-to-download mechanics, and automated Uniswap V2 graduation.

**Core Principles:**
- **EIP-1167 Factory Pattern:** 96%+ gas cost reduction using minimal proxy deployments
- **Chainlink Oracle Integration:** USD-stable pricing for launch fees and graduation thresholds
- **Constant Product Bonding Curves:** Automated market makers with virtual reserves
- **Event-Driven Architecture:** No storage arrays, optimized for The Graph indexing
- **Permanent Liquidity:** LP tokens burned to 0xdead after Uniswap V2 graduation

**Core Contracts:**
- **DatasetFactory** - EIP-1167 factory for creating dataset tokens with bonding curves
- **DatasetTokenImplementation** - Master contract for dataset tokens with burn-to-download
- **BondingCurveImplementation** - Constant product bonding curve with oracle-based graduation
- **GraduationManager** - Manages graduation from bonding curve to Uniswap V2
- **BurnPortal** - Manages token burning for authenticated dataset downloads

📖 **Detailed Documentation:** See [contracts/datamarketplace/README.md](./contracts/datamarketplace/README.md)

## Quick Start

### Installation

```bash
npm install
```

### Environment Setup

Create a `.env` file in the project root:

```env
PRIVATE_KEY=your_wallet_private_key
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_RPC_URL=https://mainnet.base.org
ETHERSCAN_API_KEY=your_basescan_api_key
```

**Never commit your `.env` file**

## Testing

### Unit Tests (150 tests, 100% passing - Reward Pool System)

```bash
# Run all tests (Reward Pool System)
npm test

# Run with coverage
npm run coverage

# Run specific test file
npx hardhat test test/RewardPoolImplementation.t.ts

# Quick security check
npx hardhat test test/SecurityQuickTest.t.ts
```

**Note:** Data Marketplace System tests will be added in future updates.

## Security Testing

### Static Analysis (Slither)

```bash
# Standard check
npm run security

# Production mode (more thorough)
npm run security:production

# Strict mode (most thorough, recommended)
npm run security:strict
```

### Property-Based Fuzzing (Echidna)

Echidna automatically generates thousands of random transactions to test invariants:

```bash
# Test RewardPool core logic (claims, fees, nonces) - ~1 min
npm run echidna:rewardpool

# Test Factory (publisher rotation, governance) - ~30 sec
npm run echidna:factory

# Quick test (token + basics) - ~20 sec
npm run echidna:quick

# Run all critical fuzzers
npm run echidna:all
```

📖 See **[ECHIDNA_FUZZING_GUIDE.md](./ECHIDNA_FUZZING_GUIDE.md)** for complete fuzzing documentation.

### Code Coverage

```bash
npm run coverage
```

## Deployment

### Deploy Reward Pool System

```bash
# Deploy to Base Sepolia (testnet)
npm run deploy-safe:baseSepolia

# Deploy to Base Mainnet
npm run deploy-safe:base

# Deploy + integration tests
npm run deploy-and-test:baseSepolia

# Validate system functionality
npm run final-validation:baseSepolia
```

**Note:** Data Marketplace System deployment scripts will be added in future updates.

## Available Commands

```bash
# Build & Test
npm run build                       # Compile contracts
npm test                           # Run all 150 tests
npm run coverage                   # Generate coverage report

# Security & Analysis
npm run security:strict            # Slither strict mode
npm run echidna:all                # All critical fuzzers
npm run echidna:rewardpool         # RewardPool fuzzer
npm run echidna:factory            # Factory fuzzer
npm run echidna:quick              # Quick fuzzing test

# Deployment
npm run deploy-safe:baseSepolia    # Deploy to testnet
npm run deploy-safe:base           # Deploy to mainnet
npm run finish-setup:baseSepolia   # Post-deployment setup

# Verification
npm run verify:baseSepolia         # Verify contracts on Basescan

# Linting
npm run lint:sol                   # Lint Solidity files
```
