# CLONES – Base (L2) Smart Contracts

Smart contracts for the **CLONES** project deployed on **Base** L2.

**Stack:** Hardhat **2.x**, Ethers **v6**, OpenZeppelin Contracts **v5.4**, OpenZeppelin Hardhat Upgrades **v3.9**, Hardhat Verify **v2**, Solhint, TypeScript.

---

## Requirements

* Node.js 18+ (or 20+), npm 9+
* Access to Base RPC endpoints (Mainnet & Sepolia)
* A deployer key (use a multisig for production)
* Basescan API key (for verification)

---

## Project Layout

```
clones-base-contracts/
├─ contracts/
│  ├─ Hello.sol                 # example contract (replace with your modules)
│  └─ utils/                    # shared libraries/helpers
├─ scripts/
│  ├─ deploy.ts                 # generic deployment script
│  ├─ verify.ts                 # generic verification script
│  ├─ upgrade.ts                # generic upgrade script (only if using proxies)
│  └─ utils.ts                  # helper functions (args parsing, registry mgmt)
├─ deployments/                 # JSON registries of deployed addresses
│  ├─ base.json
│  └─ baseSepolia.json
├─ test/
│  ├─ Hello.t.ts
│  └─ <your-tests>.t.ts
├─ hardhat.config.ts
├─ package.json
├─ tsconfig.json
├─ .solhint.json
├─ .env.example
├─ LICENSE
└─ README.md
```

---

## Installation

```bash
npm install
```

If you migrated from a different setup, clear prior artifacts:

```bash
rm -rf node_modules package-lock.json
npm cache verify
npm install
```

---

## Environment

Copy and edit:

```bash
cp .env.example .env
```

`.env` keys:

```
PRIVATE_KEY=0xabc...dead
BASE_RPC_URL=https://mainnet.base.org
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASESCAN_KEY=your_basescan_api_key
CMC_KEY=your_coinmarketcap_api_key
REPORT_GAS=false
```

> Never commit real keys. For production, route admin roles through a Safe (multisig).
> Base RPCs provided by `*.base.org` are **public/rate-limited** → use a provider (Alchemy, Infura, etc.) for production workloads.

---

## Networks

* **Base Mainnet** — `chainId: 8453`, default RPC `https://mainnet.base.org`, explorer `https://basescan.org`
* **Base Sepolia** — `chainId: 84532`, default RPC `https://sepolia.base.org`, explorer `https://sepolia.basescan.org`

`hardhat.config.ts` includes `customChains` for Basescan with `@nomicfoundation/hardhat-verify`.

---

## Scripts

All scripts are **generic**: you can use them for any contract in the repo.
They also update a `deployments/<network>.json` registry to keep track of deployed addresses and constructor args.

**Note:** The deployment script now uses environment variables to avoid conflicts with Hardhat's argument parsing.

```bash
# Compile & test
npm run build
npm test

# Deploy Hello contract to Base Sepolia (with constructor args via environment variables)
CONTRACT_NAME=Hello CONTRACT_ARGS='["Hello CLONES!"]' npx hardhat run scripts/deploy.ts --network baseSepolia

# Alternative: set environment variables separately
export CONTRACT_NAME=Hello
export CONTRACT_ARGS='["Hello CLONES!"]'
npx hardhat run scripts/deploy.ts --network baseSepolia

# Verify using registry alias (specify network)
npm run verify:baseSepolia -- --name Hello

# Verify explicitly with address + args
npm run verify:baseSepolia -- --address 0xContractAddress --args '["Hello CLONES!"]'

# Or use the generic verify script with network parameter
npm run verify -- --network baseSepolia --name Hello

**Note:** The verify script now provides the exact command to run for verification since it can't execute Hardhat's verify task directly.

# Upgrade proxy (if you use upgradeable contracts)
PROXY_ADDRESS=0xProxy IMPL_NAME=ImplV2 npm run upgrade -- --network <your-network>
```

---

## Hardhat Configuration

* Solidity: `0.8.30` (optimizer enabled)
* Ethers v6 plugin for Hardhat 2.x
* Hardhat Verify v2 with Basescan `customChains`
* Gas reporter (optional)

example highlights from `hardhat.config.ts`:

```ts
solidity: { version: "0.8.30", settings: { optimizer: { enabled: true, runs: 600 } } },
networks: {
  base:        { chainId: 8453,  url: process.env.BASE_RPC_URL,        accounts: [process.env.PRIVATE_KEY!] },
  baseSepolia: { chainId: 84532, url: process.env.BASE_SEPOLIA_RPC_URL, accounts: [process.env.PRIVATE_KEY!] }
},
etherscan: {
  apiKey: { base: process.env.BASESCAN_KEY!, baseSepolia: process.env.BASESCAN_KEY! },
  customChains: [
    { network: "base", chainId: 8453, urls: { apiURL: "https://api.basescan.org/api", browserURL: "https://basescan.org" } },
    { network: "baseSepolia", chainId: 84532, urls: { apiURL: "https://api-sepolia.basescan.org/api", browserURL: "https://sepolia.basescan.org" } }
  ]
}
```

---

## Testing

* Write unit and integration tests under `test/` using Mocha/Chai.
* Prefer **behavioral assertions** and cover:

  * access control (happy/revert paths),
  * state transitions & events,
  * boundary conditions,
  * failure scenarios (reentrancy, paused state, invalid params),
  * at least basic fuzzing with randomized inputs (where meaningful).

Run:

```bash
npm test
```

Coverage and gas reporting can be integrated in CI.

---

## Code Quality & Style

* **Solhint** with a strict ruleset (`.solhint.json`):

  * pin compiler: `^0.8.30`
  * explicit visibilities
  * reason strings length
* Prefer **custom errors** over `require(string)` for gas-efficient reverts.
* Emit events for privileged state changes and external-facing mutations.
* Document invariants and trust assumptions in NatSpec.

---

## Security Practices

* Principle of least privilege; separate `DEFAULT_ADMIN_ROLE` and operational roles.
* Protect external state-changing functions with proper checks (`onlyRole`, `whenNotPaused`, `nonReentrant` where needed).
* Avoid raw `delegatecall` and `selfdestruct`.
* No unbounded loops over user-controlled arrays in hot paths.
* Validate external addresses and params.
* Admin keys in **Safe (multisig)**; time-lock high-impact operations if governance is introduced.
* Before mainnet:

  * static analysis (Slither),
  * property-based testing (Echidna),
  * external review where appropriate.
