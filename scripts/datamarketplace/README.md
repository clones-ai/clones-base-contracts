# Datamarketplace Deployment Scripts

Deployment and management scripts for datamarketplace contracts using the EIP-1167 factory pattern.

## 📁 Script Structure

```
scripts/datamarketplace/
├── deploy-implementations.ts    # Deploys implementation contracts (step 1)
├── deploy-managers.ts          # Deploy GraduationManager and BurnPortal (step 2)
├── deploy-factory.ts           # Deploy DatasetFactory (step 3)
├── deploy-complete-system.ts   # Complete orchestrated deployment (recommended)
├── verify-contracts.ts         # Verification on block explorer
├── test-deployment.ts          # System functionality testing
└── README.md                   # This file
```

## 🚀 Deployment Order

### Option 1: Complete Deployment (Recommended)

```bash
# Deploy the entire system at once
npx hardhat run scripts/datamarketplace/deploy-complete-system.ts --network baseSepolia
npx hardhat run scripts/datamarketplace/deploy-complete-system.ts --network base
```

### Option 2: Step-by-Step Deployment

```bash
# 1. Deploy implementations
npx hardhat run scripts/datamarketplace/deploy-implementations.ts --network baseSepolia

# 2. Deploy managers
npx hardhat run scripts/datamarketplace/deploy-managers.ts --network baseSepolia

# 3. Deploy factory
npx hardhat run scripts/datamarketplace/deploy-factory.ts --network baseSepolia
```

## 📋 Prerequisites

### Environment Variables

Create a `.env` file with:

```bash
# Deployer private key
PRIVATE_KEY=your_private_key_here

# RPC URLs
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_RPC_URL=https://mainnet.base.org

# API Key for verification
ETHERSCAN_API_KEY=your_basescan_api_key

# Optional addresses (uses deployer as default if not specified)
PROTOCOL_FEE_RECIPIENT=0x...
TIMELOCK_ADDRESS=0x...
GUARDIAN_ADDRESS=0x...
```

### Required Tokens

**For testing:** The deployer must have CLONES tokens to pay launch fees.

**CLONES token addresses:**
- Base Mainnet: `0xaadd98Ad4660008C917C6FE7286Bc54b2eEF894d`
- Base Sepolia: `0x15eB86c7E54B350bf936d916Df33AEF697202E29`

## 🔧 Detailed Scripts

### 1. deploy-implementations.ts

Deploys the master contracts for the EIP-1167 pattern:
- `DatasetTokenImplementation.sol`
- `BondingCurveImplementation.sol`

**Usage:**
```bash
npx hardhat run scripts/datamarketplace/deploy-implementations.ts --network baseSepolia
```

**Output:** Saves addresses in `deployments/{network}.json`

### 2. deploy-managers.ts

Deploys the management contracts:
- `GraduationManager.sol` - Manages graduation to Uniswap V2
- `BurnPortal.sol` - Manages burn-to-download

**Automatic configuration:**
- Base Mainnet: Real Uniswap V2 addresses
- Base Sepolia: Test addresses

**Usage:**
```bash
npx hardhat run scripts/datamarketplace/deploy-managers.ts --network baseSepolia
```

### 3. deploy-factory.ts

Deploys the main factory `DatasetFactory.sol`.

**Prerequisites:** Implementations must be deployed.

**Configured parameters:**
- Launch fee: 100 CLONES (~$50)
- Min liquidity: 0.01 ETH
- Max liquidity: 100 ETH

**Usage:**
```bash
npx hardhat run scripts/datamarketplace/deploy-factory.ts --network baseSepolia
```

### 4. deploy-complete-system.ts

Complete orchestration that:
1. Deploys all implementations
2. Deploys managers
3. Deploys factory
4. Configures interconnections
5. Tests configuration

**Usage:**
```bash
npx hardhat run scripts/datamarketplace/deploy-complete-system.ts --network baseSepolia
```

**Advantages:**
- Atomic deployment
- Automatic configuration
- Post-deployment validation

### 5. verify-contracts.ts

Verifies all contracts on Basescan.

**Prerequisites:** `ETHERSCAN_API_KEY` configured.

**Usage:**
```bash
npx hardhat run scripts/datamarketplace/verify-contracts.ts --network baseSepolia
```

**Features:**
- Reads arguments from registry
- Handles already verified contracts
- Displays block explorer links

### 6. test-deployment.ts

End-to-end testing of the deployed system.

**Tests performed:**
1. ✅ Factory state verification
2. ✅ CLONES balance and allowance
3. ✅ Address prediction
4. ✅ Test dataset creation
5. ✅ EIP-1167 proxy verification
6. ✅ Token purchase on bonding curve

**Usage:**
```bash
npx hardhat run scripts/datamarketplace/test-deployment.ts --network baseSepolia
```

## 📊 Registry System

All scripts use the unified registry system:

```json
{
  "networkName": "base-sepolia",
  "chainId": 84532,
  "timestamp": "2024-01-15T10:30:00Z",
  "deployer": "0x...",
  "configured": true,
  "contracts": {
    "DatasetTokenImplementation": {
      "address": "0x...",
      "txHash": "0x...",
      "args": []
    },
    "DatasetFactory": {
      "address": "0x...",
      "txHash": "0x...",
      "args": ["0x...", "0x...", ...]
    }
  }
}
```

**Location:** `deployments/{network}.json`

## 🔍 Post-Deployment Verification

### Validation Checklist

- [ ] All implementations deployed
- [ ] Factory configured with correct implementations
- [ ] BurnPortal references the factory
- [ ] GraduationManager configured
- [ ] Test dataset creation successful
- [ ] Contracts verified on Basescan

### Diagnostic Commands

```bash
# Check factory state
npx hardhat console --network baseSepolia
> const factory = await ethers.getContractAt("DatasetFactory", "0x...")
> await factory.getTotalDatasets()

# Check implementations
> await factory.DATASET_TOKEN_IMPLEMENTATION()
> await factory.BONDING_CURVE_IMPLEMENTATION()
```

## 🛠 Troubleshooting

### Common Errors

**1. "Implementation not found"**
```bash
# Solution: Deploy implementations first
npx hardhat run scripts/datamarketplace/deploy-implementations.ts --network baseSepolia
```

**2. "Insufficient CLONES balance"**
```bash
# Solution: Get test CLONES tokens
# On Sepolia, contact team for test tokens
```

**3. "Factory address not set in BurnPortal"**
```bash
# Solution: Update factory address
npx hardhat console --network baseSepolia
> const burnPortal = await ethers.getContractAt("BurnPortal", "0x...")
> await burnPortal.updateDatasetFactory("0x...")
```

### Logs and Debug

Enable detailed debugging:
```bash
DEBUG=* npx hardhat run scripts/datamarketplace/deploy-complete-system.ts --network baseSepolia
```

## 🚀 Production Deployment

### Base Mainnet

```bash
# Production environment variables
export PROTOCOL_FEE_RECIPIENT=0x... # Treasury address
export TIMELOCK_ADDRESS=0x...      # Multisig timelock address
export GUARDIAN_ADDRESS=0x...      # Guardian address

# Production deployment
npx hardhat run scripts/datamarketplace/deploy-complete-system.ts --network base

# Verification
npx hardhat run scripts/datamarketplace/verify-contracts.ts --network base

# System testing
npx hardhat run scripts/datamarketplace/test-deployment.ts --network base
```

### Security

⚠️ **Important for production:**
- Use a multisig as deployer
- Verify all addresses before deployment
- Test on Sepolia before mainnet
- Keep a copy of the deployment registry
- Document all addresses for the team

## 📞 Support

In case of issues:
1. Check deployment logs
2. Consult the registry `deployments/{network}.json`
3. Test with `test-deployment.ts`
4. Contact the team with error details