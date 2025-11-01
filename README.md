# install dependencies
npm install --save-dev hardhat typescript ts-node @types/node @nomicfoundation/hardhat-toolbox ethers

# start local chain
npx hardhat node

# deploy contracts
npm run deploy
This prints deployed contract addresses. Copy the DatasetToken address

# run tests
npm test

# start gateway
export TOKEN_ADDRESS=<DatasetToken address>
export RPC=http://127.0.0.1:8545
npm run start:gateway

# End-to-End Lifecycle
1. Creator uploads & certifies dataset (>50 % score)
2. Gateway verifies signature → deploys ERC-20 + AMM
3. Users trade along curve (no burns yet)
4. At $69 k market cap → auto graduation → LP burned
5. Burn Portal opens → users burn tokens → download dataset
6. Royalties distributed per EIP-2981

# Core concepts encoded on-chain
Fixed Supply per dataset: 1,000,000,000 (6 decimals)
Virtual reserves for curve shaping (avoid singularity): vEth, vTok set at launch
Speculation Phase: buy/sell along curve, burns disabled
Fees (forever): 0.25% creator, 0.75% protocol (taken from trade ETH)
Graduation: when market cap ≥ $69,000 (via Chainlink oracle), triggers Uniswap V2 migration; LP burned to 0xdead
Burn Portal: after graduation, holders may burnThreshold fraction (1–10% of supply) to unlock dataset IPFS download
Provenance: IPFS CID + creator address + quality report hash are immutably recorded

# Off-chain unlock flow (high level)

User burns with BurnPortal.burnAndUnlock(token, amount ≥ threshold).
Off-chain listener (Node/NestJS/FastAPI) watches BurnAccess events.
Service verifies event → generates one-time, time-limited signed URL for datasetCID via gateway (or uses IPFS HTTP Gateway with HMAC).
URL returned to the connected wallet session → instant download.

# Core concepts on-chain
DatasetRegistry stores: id, slug, token, creator, metadataCID, createdAt, updatedAt, providerId.
DatasetFactory creates tokens & pools and registers them in Registry.
BondingCurvePool exposes view functions for: virtual reserves, live reserves, k, price and flags (graduated).
BurnPortal routes burns through Factory (only Factory can burn the token) and emits BurnAccess.

# DatasetToken

What it is: An ERC-20 for a single dataset with:
Fixed supply = 1,000,000,000 tokens (6 decimals).
Immutable burnThreshold (1–10% of supply) = the cost to unlock the dataset once it’s graduated.
Immutable datasetCID (IPFS CID) and qualityReportCID for provenance.
A graduated flag (false while on curve, true after DEX migration).

Special rule: burnFrom is callable only by the Factory (designated authority) and only after graduation. Holders themselves don’t burn directly; they request a burn via the portal which routes through the Factory. This prevents anyone from faking a burn off-flow and also centralizes post-checks (e.g., rate-limits, allowlists if ever needed).

Why factory-gated burning?
So the protocol can enforce “no burns during speculation phase,” and so the burn pipeline can emit a canonical event the off-chain unlocker trusts.

# BondingCurvePool

What it is: A one-way buy pool implementing a virtual-reserves constant-product curve:
Invariant on virtual reserves: k = (E + vE) × (T + vT)
Price ≈ (E + vE) / (T + vT) (ETH per token)
Fees on every buy: 0.25% to creator, 0.75% to protocol (forever).
No sells during speculation. You can add a sell path later if desired.
Anti-bot switch: tradingEnabled flag that the creator can pause before graduation (UI still enforces human checks with captcha/rate limit).


# DatasetFactory

What it is: The protocol coordinator:
Launches a dataset: deploys DatasetToken, deploys BondingCurvePool, holds the initial 0.02 ETH for future LP.
Holds burn authority for the token (see above).
Graduates a dataset when market cap target is hit:
Creates UniswapV2 LP pair.
Adds all raised ETH + 206.9M reserved tokens as liquidity.
Sends LP to 0xdead (burned liquidity).
Sets token to graduated = true and enables the Burn Portal.
Emits rich events (DatasetLaunched, Graduated) that the subgraph indexes.
Market cap gating: Factory compares price to the Chainlink ETH/USD feed and checks the target (~$69k) before calling graduate().


# BurnPortal
What it is: The interactive gateway after graduation. Users connect a wallet and request an unlock:
It does not burn tokens itself. Instead it calls the Factory, which calls token.burnFrom(user, amount) (enforcing “only Factory can burn”).
Emits a BurnAccess(user, token, amount, datasetCID) event used by the off-chain unlock service to deliver the download.


# Lifecycle: from launch → graduation → burn-to-download

## Launch (speculation-only)
Creator uploads provenance to IPFS, picks burn threshold (e.g., 5%), and seeds the curve with 793.1M tokens in the BondingCurvePool.
Factory holds 0.02 ETH to later seed DEX liquidity at graduation.
No burns are possible yet.
## Price discovery on the curve
Buyers send ETH to BondingCurvePool.buy().
Pool uses virtual reserves to compute tokens-out and updates (E, T).
Fees stream to creator & protocol on every buy.
## Graduation
Once the on-chain price → implied market cap ≥ target (~$69k), Factory.graduate():
Adds all raised ETH + 206.9M tokens to Uniswap V2.
Sends LP to 0xdead (permanent liquidity; no rugs).
Marks the curve pool as closed and the token as graduated = true.
## Burn-to-download
Holder requests an unlock in the Burn Portal.
Burn Portal → Factory → token.burnFrom(holder, threshold).
Factory emits BurnAccess(user, token, amount, datasetCID) event.
Off-chain unlock service sees the event, verifies it, and returns a one-time download (details below).

# How the dataset lives on IPFS and stays locked

IPFS itself is public content addressing, so the lock is done by encryption + key release. Here’s the recommended setup:

## Encrypt on IPFS
Encrypt the dataset locally before pinning:
Use AES-256-GCM with a random 256-bit key K and random nonce per chunk.
(Optional) Chunk/split and generate a metafile manifest (list of CIDs).
Upload the encrypted files to IPFS; record the CID (this is what goes into DatasetToken.datasetCID).
Store the decryption key K in your unlock service (HSM/KMS preferred), never on-chain.
### On successful burn:
Off-chain listener verifies BurnAccess (wallet, token, amount ≥ threshold, token.graduated == true).
Service generates a single-use, short-TTL response that includes:
A pre-signed gateway URL (or direct IPFS fetch) to the encrypted asset(s).
The decryption key K, delivered only to the requestor’s wallet session (e.g., via a signed backend response bound to the wallet address + nonce).
Client downloads encrypted blobs and decrypts locally in the browser (WebCrypto) or streams/decrypts server-side for the user.

Pros: Cryptographically locked until burn; even if someone finds the CID, it’s useless without K.
Cons: Users can still redistribute after they decrypt—this is true for any downloadable dataset. You mitigate with watermarking/licensing.

# What prevents pre-burn access?

The CID stored on-chain points to encrypted data (or to a gateway that won’t serve without a valid signature).
The decryption key is never on-chain and only released after a verifiable burn event.
The unlock service only honors burns emitted by your Factory (the single authorized burner), so spoofed transactions or direct token transfer() noise can’t trick it.
If you use Lit Protocol / threshold networks, you can require an on-chain condition (e.g., “this wallet burned ≥ threshold”) to automatically release K via distributed key control; this removes your backend from the trust path, though it’s more complex to integrate.

# The exact unlock flow (message-level)

User clicks “Burn & Download”
Frontend asks wallet to sign a short-lived auth message (anti-CSRF).
Backend verifies ownership of the wallet address and calls:
Factory.burnForAccess(tokenAddress, msg.sender, burnThreshold) (or similar).
Factory calls token.burnFrom(user, amount) (since only the Factory is allowed).
Factory emits BurnAccess(user, token, amount, datasetCID, timestamp).
Unlock service (subscribed to events) validates:
token.graduated == true
amount >= burnThreshold
event.user matches the session wallet
Unlock service responds with:
Key K (if using encryption) or a signed, single-use, short-TTL URL (if not using encryption).
Optionally a per-user watermark payload.
Frontend downloads and (if encrypted) decrypts client-side via WebCrypto.

# Bonding-curve & graduation math (quick intuition)

With virtual reserves, you shape the early slope and avoid singularity at the first trade:
price(ETH/token) = (E + vE) / (T + vT)
Each buy moves you up the curve, increasing price; fees siphon off to creator/protocol.
The subgraph tracks:
currentPrice, volume24h, holders, k = (E+vE)(T+vT), bondingCurveProgress = marketCap / target.
Graduation freezes the curve, migrates liquidity to UniswapV2, burns LP, and flips graduated = true.


# Map required fields
## On-chain & views:
id, slug, tokenAddress, owner (creator), createdAt, updatedAt, provider.id → DatasetRegistry
bondingCurve.currentPrice, totalSupply, virtualEthReserve, virtualTokenReserve, k, isGraduated → BondingCurvePool + DatasetToken (via Factory.getBondingCurve)
graduationThreshold → supplied to the view or stored off-chain/subgraph
## Off-chain/IPFS (metadataCID):
name, description, category, size, format, metadata.tags/license/quality/samples/features/previewUrl/thumbnailUrl, provider.name/avatar
## Off-chain/DB (Mongo via Mongoose):
rating, reviewCount, plus any extra analytics like volume24h, marketCap (you can also compute these in the subgraph)


# Test step on local
1. npx hardhat node
2. npx hardhat compile
3. npx hardhat run --network localhost deploy/01_deploy_core.ts --show-stack-traces
4. Update .env with the addresses you got from the above command
   Note: Leave DEPLOYER_KEY empty for localhost; Hardhat uses unlocked accounts.
5. npx hardhat run --network localhost deploy/02_create_dataset.ts
6. npx hardhat run --network localhost deploy/02_seed_and_smoketest.ts
7. npx hardhat run --network localhost deploy/03_list_datasets.ts

# How to test on base sepolia
## create test wallet on base sepolia
node
> const { Wallet } = require("ethers");
> const w = Wallet.createRandom();
> console.log(w.address);
> console.log(w.privateKey);
Take that private key, prefix 0x, and save to .env
Note: Keep this key private, do not commit .env to GitHub
## Add Base Sepolia test ETH
You will need a small amount of ETH to pay gas
1. Go to the Base Sepolia faucet (official or via Alchemy):
   https://faucet.base.org or https://www.alchemy.com/faucets/base-sepolia
2. Paste your wallet address and request funds.
3. After a minute, check in your wallet:
   Network = “Base Sepolia Testnet”
   You should see a small ETH balance.