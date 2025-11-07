# CLONES Data Marketplace Smart Contracts

## Overview

Smart contracts implementing the tokenized AI training data marketplace with **EIP-1167 minimal proxy pattern**, bonding curves, burn-to-download mechanics, and automated Uniswap V2 graduation.

**🚀 Gas Optimized**: 96%+ cost reduction using EIP-1167 factory pattern + event-driven architecture (~$0.0003 vs $0.012 per dataset on Base L2)

## Architecture

### EIP-1167 Factory Pattern + Event-Driven Architecture
- **DatasetTokenImplementation.sol**: Master contract for all dataset tokens
- **BondingCurveImplementation.sol**: Master contract for all bonding curves  
- **DatasetFactory.sol**: Factory deploying minimal proxies with CREATE2
- **Event-Driven Indexing**: No storage arrays, events indexed by The Graph
- **96%+ Gas Savings**: ~120k gas per dataset vs 4M gas with full deployments

## Contracts

### 1. DatasetFactory.sol
**Purpose**: EIP-1167 factory for creating minimal proxy dataset tokens with bonding curves

**Key Features**:
- **EIP-1167 Clones**: Deploys lightweight proxy contracts pointing to master implementations
- **Chainlink Oracle Integration**: CLONES/USD price feed for stable $50 launch fee
- **Deterministic Addresses**: Pool addresses predictable using CREATE2 with creator + name + symbol
- **Atomic Creation**: Single transaction for token + bonding curve deployment
- **Event-Driven Architecture**: No storage arrays, datasets tracked via events for The Graph indexing
- **Gas Efficiency**: ~120k gas per dataset vs ~4M gas for full deployment
- **Quality Control**: Backend manages quality scores (removed from smart contracts)
- Collects $50 USD equivalent in CLONES tokens + 0.02 ETH liquidity
- **Oracle Safety**: 1-hour staleness threshold with fallback fee mechanism
- Fail-fast validation (burn portal must be configured)

**Functions**:
- `createDataset()` - Deploy new dataset with bonding curve using EIP-1167 (no quality score parameter)
- `predictDatasetAddress()` - Predict addresses before creation
- `getCurrentLaunchFee()` - Get current $50 USD fee in CLONES tokens via oracle
- `setLaunchFee()` - Update fallback launch fee (timelock)
- `setGraduationManager()` - Set graduation manager address

### 2. DatasetTokenImplementation.sol
**Purpose**: EIP-1167 implementation contract for dataset tokens with burn-to-download

**Key Features**:
- **Proxy Implementation**: Single master contract for all dataset tokens
- **Initialization**: Called by factory to setup token parameters
- Fixed supply: 1,000,000,000 tokens (6 decimals)
- Distribution: 793.1M for bonding curve, 206.9M for LP
- Burn threshold: 1-10% of supply for download access
- Only burns allowed after graduation

**Functions**:
- `initialize()` - Initialize proxy instance (factory only)
- `setBondingCurve()` - Set bonding curve address (factory only)
- `setBurnPortal()` - Set burn portal address
- `graduate()` - Mark as graduated, transfer LP tokens (graduation manager only)
- `burnForDownload()` - Burn tokens for dataset access (burn portal only)

### 3. BondingCurveImplementation.sol
**Purpose**: EIP-1167 implementation for constant product bonding curve (V_ETH × V_TOK = K)

**Key Features**:
- **Proxy Implementation**: Single master contract for all bonding curves
- **Chainlink Oracle Integration**: ETH/USD price feed for stable $69k graduation threshold
- **Initialization**: Called by factory with liquidity contribution + oracle address
- Virtual reserves: ~1.3 ETH × 1.073B tokens
- Starting price: ~1.21×10⁻⁹ ETH/token
- Graduation at $69k USD market cap (oracle-based, ~23 ETH at $3k/ETH)
- Trading fees: 1% (0.25% creator, 0.75% protocol)
- **Oracle Safety**: 1-hour staleness threshold with fallback logic

**Functions**:
- `initialize()` - Initialize proxy instance with liquidity + ETH/USD oracle (factory only)
- `buyTokens()` - Buy tokens with ETH, auto-check graduation via oracle
- `sellTokens()` - Sell tokens for ETH
- `getCurrentPrice()` - Get current token price
- `getCurrentGraduationThreshold()` - Get current $69k threshold in ETH via oracle
- `getCurrentMarketCapUSD()` - Get market cap in USD via oracle
- `getTokensOut()` / `getETHOut()` - Quote calculations
- `finalizeGraduation()` - Transfer assets to graduation manager

### 4. BurnPortal.sol
**Purpose**: Manages token burning for dataset download access

**Key Features**:
- Only active after graduation
- Requires burn threshold amount
- Tracks burn statistics per dataset
- Prevents double-burning

**Functions**:
- `burnForDownload()` - Burn tokens for access
- `hasAccess()` - Check if user has access
- `getBurnStats()` - Get burn count and total burned
- `getBurners()` - List of all burners

### 5. GraduationManager.sol
**Purpose**: Manages graduation from bonding curve to Uniswap V2

**Key Features**:
- Creates Uniswap V2 LP pair
- Burns all LP tokens to 0xdead (permanent liquidity)
- Activates burn portal
- Stores graduation metadata

**Functions**:
- `graduateDataset()` - Execute graduation and LP migration
- `setBurnPortal()` - Set burn portal address
- `getGraduationInfo()` - Get LP pair and timestamp
- `rescueTokens()` / `rescueETH()` - Emergency recovery

### 6. CLONES Token (Pre-deployed)
**Purpose**: Protocol token for launch fees

**Contract Addresses**:
- **Base Mainnet**: `0xaadd98Ad4660008C917C6FE7286Bc54b2eEF894d`
- **Base Sepolia**: `0x15eB86c7E54B350bf936d916Df33AEF697202E29`

**Key Features**:
- Fixed supply: 1,000,000,000 tokens (18 decimals)
- Burnable by holders
- ERC20Permit support for gasless approvals
- Used for dataset launch fees ($50 CLONES per launch)
- Non-upgradeable, ownership can only be renounced

**Functions**:
- `burn()` / `burnFrom()` - Burn tokens
- `permit()` - Gasless approvals
- `balanceOf()` / `transfer()` - Standard ERC20

## Contract Standards

### Dependencies
- **OpenZeppelin v5.0+**: Battle-tested implementations
  - `ERC20` - Standard token interface
  - `ERC20Burnable` - Burn functionality
  - `AccessControl` - Role-based access control
  - `ReentrancyGuard` - Reentrancy protection
  - `SafeERC20` - Safe token transfers
  - `Math` - Precision arithmetic
- **Chainlink Oracles**: Price feed integration
  - `IAggregatorV3Interface` - ETH/USD and CLONES/USD price feeds

## Deployment Order

### EIP-1167 Factory System Deployment

1. **Deploy Implementation Contracts**:
   - Deploy `DatasetTokenImplementation.sol` (master contract)
   - Deploy `BondingCurveImplementation.sol` (master contract)

2. **Deploy Management Contracts**:
   - Deploy `GraduationManager` with Uniswap V2 Router/Factory addresses
   - Deploy `BurnPortal` with timelock and guardian

3. **Deploy Factory System**:
   - Deploy `DatasetFactory` with implementation addresses, CLONES token, and oracle addresses
   - Set GraduationManager in DatasetFactory
   - Set BurnPortal in GraduationManager

4. **Use Existing Infrastructure**:
   - **CLONES Token**: Pre-deployed on Base Mainnet/Sepolia
   - **Chainlink Oracles**: Use existing ETH/USD and CLONES/USD price feeds on Base

## Security Considerations

### Audits Required
- **Critical**: DatasetFactory, DatasetTokenImplementation, BondingCurveImplementation, GraduationManager
- **High**: BurnPortal
- **Medium**: EIP-1167 proxy initialization patterns

### Key Risks
1. **EIP-1167 Implementation**: Initialization security, proxy delegation safety
2. **Bonding Curve Math**: Precision loss, overflow/underflow in proxy context
3. **Oracle Dependencies**: Chainlink price feed failures, staleness, manipulation
4. **Reentrancy**: All payable functions protected across proxy boundaries
5. **Access Control**: Factory vs implementation permissions
6. **Front-running**: Consider MEV protection for trades
7. **Proxy Initialization**: Prevent implementation contract direct usage

### Recommended Tools
- Slither (static analysis)
- Echidna (fuzzing)
- Foundry (unit tests + invariants)
- Hardhat (integration tests)

## Testing Checklist

### Unit Tests
- [ ] **EIP-1167 Functionality**:
  - [ ] Implementation initialization prevention
  - [ ] Proxy creation and initialization
  - [ ] Factory address prediction accuracy
  - [ ] CREATE2 deterministic addresses
- [ ] **Token Operations**:
  - [ ] Token minting/burning through proxies
  - [ ] Proxy delegation correctness
- [ ] **Bonding Curve**:
  - [ ] Price calculations in proxy context
  - [ ] Buy/sell with various amounts
  - [ ] Fee distribution (creator + protocol)
  - [ ] Graduation trigger at $69k
- [ ] **System Integration**:
  - [ ] LP creation and burning
  - [ ] Burn portal access control

### Integration Tests
- [ ] Full dataset lifecycle (create → trade → graduate → burn)
- [ ] Multiple simultaneous datasets via factory
- [ ] Edge cases (zero amounts, max values)
- [ ] Uniswap integration with graduated tokens
- [ ] Gas optimization comparison (EIP-1167 vs full deployment)

### Invariants
- [ ] K constant holds across all proxy instances
- [ ] Total supply never exceeds max per dataset
- [ ] Fees always sum to 1% across all curves
- [ ] LP tokens always burned to 0xdead
- [ ] Only factory can create valid proxies
- [ ] Implementation contracts remain uninitialized

## Gas Optimization

### Estimated Gas Costs (Base L2 at 0.001 gwei, ETH at $3000)

#### EIP-1167 Factory Deployment (One-time)
- Deploy DatasetTokenImplementation: ~1.8M gas (~$0.005)
- Deploy BondingCurveImplementation: ~2.2M gas (~$0.007)
- Deploy DatasetFactory: ~1.2M gas (~$0.004)
- **Total Setup**: ~5.2M gas (~$0.016)

#### Per Dataset Operations (96%+ Savings vs Full Deployment)
- **Create Dataset**: ~120k gas (~$0.0003) ✅ vs 4M gas (~$0.012) ❌
- Buy tokens: ~80k gas (~$0.0002)
- Sell tokens: ~90k gas (~$0.0003)
- Burn for download: ~60k gas (~$0.0002)
- Graduate dataset: ~800k gas (~$0.0024)

#### Scalability Analysis
- **1,000 datasets**: $0.30 total vs $12 traditional
- **10,000 datasets**: $3.00 total vs $120 traditional
- **Break-even**: 350 datasets (setup costs recovered)

### Optimization Tips
- **Event-Driven Architecture**: Use events for indexing instead of storage arrays
- Use 6 decimals for dataset tokens (vs 18)
- Pack storage variables efficiently  
- Cache storage reads
- Use unchecked blocks where safe
- Remove off-chain data from smart contracts (quality scores → backend)

## Frontend Integration

### Web3 Libraries
- wagmi + viem (React)
- ethers.js v6 (alternative)
- RainbowKit (wallet connection)

### Contract ABIs
- Export ABIs to `src/lib/abis/` directory
- Use TypeScript for type-safe interactions

### Event Indexing (The Graph Protocol)
- **DatasetCreated**: Track all dataset creations (replaces storage arrays)
- **Buy/Sell**: Trading volume and price history
- **BurnForDownload**: Dataset access and usage metrics  
- **DatasetGraduated**: Uniswap V2 migration tracking
- **Gas Efficient**: Events cost ~2k gas vs 20k+ for storage arrays

## Future Upgrades

### V2 Considerations
- Upgradeable contracts (OpenZeppelin UUPS)
- Dynamic burn thresholds
- Multi-tier access (burn less for preview)
- Governance token integration
- Cross-chain deployment (Base, Arbitrum, Optimism)

## License

MIT License - see LICENSE file

## Support

For questions or issues:
- GitHub Issues: [repo-link]
- Discord: [discord-link]
- Documentation: [docs-link]
