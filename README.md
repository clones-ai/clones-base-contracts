# Clones Base Contracts

Official smart contracts for the Clones protocol on the Base L2 network. This project implements a factory-based reward pool system using EIP-1167 minimal proxy pattern for efficient deployment of individual reward pools.

Built with **Hardhat**, **Ethers.js v6**, and **OpenZeppelin Contracts v5**.

[![Tests](https://img.shields.io/badge/tests-150%2F150%20passing-brightgreen)]()
[![Coverage](https://img.shields.io/badge/coverage-83.82%25-green)]()
[![Security](https://img.shields.io/badge/slither-0%20findings-brightgreen)]()
[![Fuzzing](https://img.shields.io/badge/echidna-18%2F18%20invariants-brightgreen)]()
[![Audit Ready](https://img.shields.io/badge/audit-ready-blue)]()


## Project Architecture & Standards

This repository implements a modern factory-based architecture for reward pool management. All contracts adhere to high-quality standards ensuring security, gas efficiency, and maintainability.

### Core Principles
- **Security First:** Defense-in-depth approach with reentrancy protection, access control, and L2-specific safety features
- **Gas Optimization:** EIP-1167 minimal proxy pattern reduces deployment costs by 99%+ compared to full contract deployments
- **Deterministic Addresses:** CREATE2 implementation allows prediction of pool addresses before deployment
- **Batch Operations:** ClaimRouter enables efficient multi-vault reward claiming in a single transaction
- **EIP-712 Signatures:** Secure, off-chain signed reward claims with replay protection


## Core Contracts

### 1. RewardPoolFactory

The `RewardPoolFactory` is the core factory contract that creates deterministic reward pools using EIP-1167 minimal proxy pattern.

**Key Features:**
- **EIP-1167 Clones:** Deploys lightweight proxy contracts (CREATE2) pointing to a master implementation
- **Deterministic Addresses:** Pool addresses are predictable using creator + token combination
- **Token Allowlist:** Only approved tokens can be used for pool creation
- **Publisher Management:** Role-based system for authorized reward publishers with rotation and grace periods
- **Minimal Gas Cost:** ~50k gas per pool creation vs ~2M gas for full deployment
- **Atomic Create+Fund:** Single transaction for pool creation and initial funding

### 2. RewardPoolImplementation

The `RewardPoolImplementation` serves as the master contract containing all pool logic that is shared by minimal proxies.

**Key Features:**
- **EIP-712 Signatures:** Secure reward claiming with typed data signatures
- **Cumulative Rewards:** Prevents double-spending with cumulative reward tracking
- **Nonce-Based Replay Protection:** Per-account nonces prevent signature reuse
- **Rate Limiting:** MAX_CLAIMS_PER_BLOCK = 50 with circuit breakers
- **Fee Collection:** Transparent 10% platform fee on all reward claims
- **Creator Controls:** 7-day timelock and 50% withdrawal limits for creator protection
- **Security Monitoring:** High-value claim detection and suspicious activity alerts

### 3. ClaimRouter

The `ClaimRouter` enables efficient batch claiming across multiple reward pools in a single transaction.

**Key Features:**
- **Multi-Vault Batching:** Claim rewards from multiple pools atomically
- **Gas Optimization:** Reduces transaction costs for users with multiple active pools
- **Factory Verification:** Only processes claims from approved factory-created pools
- **Batch Size Limits:** Configurable limits prevent gas exhaustion attacks
- **Atomic Operations:** All claims succeed or fail together

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

**⚠️ Never commit your `.env` file**

## Testing

### Unit Tests (150 tests, 100% passing)

```bash
# Run all tests
npm test

# Run with coverage
npm run coverage

# Run specific test file
npx hardhat test test/RewardPoolImplementation.t.ts

# Quick security check
npx hardhat test test/SecurityQuickTest.t.ts
```

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

### Deploy Factory System

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
