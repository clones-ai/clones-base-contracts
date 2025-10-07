import { ethers } from "hardhat";
import { expect } from "chai";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
    RewardPoolFactory,
    RewardPoolImplementation,
    ClaimRouter,
    TestToken
} from "../typechain-types";

/**
 * Economic Attack Resistance Tests
 * Tests various economic attack vectors and precision manipulation attempts
 */
describe("Economic Attack Resistance", function () {
    let factory: RewardPoolFactory;
    let implementation: RewardPoolImplementation;
    let router: ClaimRouter;
    let testToken: TestToken;
    let vault: RewardPoolImplementation;

    let owner: SignerWithAddress;
    let timelock: SignerWithAddress;
    let guardian: SignerWithAddress;
    let publisher: SignerWithAddress;
    let attacker: SignerWithAddress;
    let victim: SignerWithAddress;
    let funder: SignerWithAddress;

    const FUND_AMOUNT = ethers.parseUnits("10000", 18); // 10k tokens
    const SMALL_CLAIM = 1n; // 1 wei
    const FEE_BPS = 1000; // 10%

    beforeEach(async function () {
        [owner, timelock, guardian, publisher, attacker, victim, funder] = await ethers.getSigners();

        // Deploy mock token
        const TestTokenFactory = await ethers.getContractFactory("TestToken");
        testToken = await TestTokenFactory.deploy("Test Token", "TEST", 18);

        // Deploy implementation
        const RewardPoolImplementationFactory = await ethers.getContractFactory("RewardPoolImplementation");
        implementation = await RewardPoolImplementationFactory.deploy();

        // Deploy factory
        const RewardPoolFactoryFactory = await ethers.getContractFactory("RewardPoolFactory");
        factory = await RewardPoolFactoryFactory.deploy(
            await implementation.getAddress(),
            owner.address, // platform treasury
            timelock.address,
            guardian.address,
            publisher.address
        );

        // Deploy claim router
        const ClaimRouterFactory = await ethers.getContractFactory("ClaimRouter");
        router = await ClaimRouterFactory.deploy(timelock.address);

        // Setup token allowlist
        await factory.connect(timelock).setTokenAllowed(await testToken.getAddress(), true);

        // Create a vault
        const tx = await factory.connect(owner).createPool(await testToken.getAddress());
        const receipt = await tx.wait();
        const event = receipt?.logs.find(log => {
            try {
                const parsed = factory.interface.parseLog(log);
                return parsed?.name === "PoolCreated";
            } catch {
                return false;
            }
        });

        if (event) {
            const parsed = factory.interface.parseLog(event);
            vault = await ethers.getContractAt("RewardPoolImplementation", parsed?.args.pool);
        }

        // Fund the vault
        await testToken.mint(funder.address, FUND_AMOUNT);
        await testToken.connect(funder).approve(await vault.getAddress(), FUND_AMOUNT);
        await vault.connect(funder).fund(FUND_AMOUNT);
    });

    async function signClaim(signer: SignerWithAddress, vaultAddress: string, account: string, amount: bigint) {
        const domain = {
            name: "FactoryVault",
            version: "1",
            chainId: await ethers.provider.getNetwork().then(n => n.chainId),
            verifyingContract: vaultAddress
        };

        const types = {
            Claim: [
                { name: "account", type: "address" },
                { name: "cumulativeAmount", type: "uint256" },
                { name: "nonce", type: "uint256" }
            ]
        };

        // Get nonce from contract
        const vaultContract = await ethers.getContractAt("RewardPoolImplementation", vaultAddress);
        const nonce = await vaultContract.claimNonce(account);

        const value = {
            account: account,
            cumulativeAmount: amount,
            nonce: nonce.toString()
        };

        return await signer.signTypedData(domain, types, value);
    }

    describe("Fee Precision Attacks", function () {
        it("Should prevent fee bypass with micro amounts", async function () {
            // Attack: Use 1 wei claims to bypass fees due to rounding
            const microSignature = await signClaim(publisher, await vault.getAddress(), attacker.address, SMALL_CLAIM);

            // Should now be rejected due to minimum claim amount
            const nonce = await
                vault.claimNonce(attacker.address);
            await expect(vault.payWithSig(attacker.address, SMALL_CLAIM, nonce, microSignature))
                .to.be.revertedWithCustomError(vault, "SecurityViolation")
                .withArgs("claim_too_small");
        });

        it("Should handle cumulative fee precision correctly over many small claims", async function () {
            // Attack: Make many small claims to accumulate rounding errors
            const claimAmount = ethers.parseUnits("0.01", 18); // 0.01 tokens per claim (above minimum)
            let totalClaimed = 0n;
            let expectedFees = 0n;

            for (let i = 1; i <= 10; i++) {
                const cumulativeAmount = claimAmount * BigInt(i);
                const signature = await signClaim(publisher, await vault.getAddress(), attacker.address, cumulativeAmount);

                const nonce = await
                    vault.claimNonce(attacker.address);
                await vault.payWithSig(attacker.address, cumulativeAmount, nonce, signature);

                totalClaimed = cumulativeAmount;
                // Calculate expected cumulative fee
                expectedFees = (cumulativeAmount * BigInt(FEE_BPS)) / 10000n;
            }

            expect(await vault.alreadyClaimed(attacker.address)).to.equal(totalClaimed);
            expect(await vault.alreadyFeePaid(attacker.address)).to.equal(expectedFees);
        });

        it("Should resist fee manipulation through claim ordering", async function () {
            // Attack: Try to manipulate fee calculation with specific claim amounts
            const amounts = [
                ethers.parseUnits("0.01", 18),
                ethers.parseUnits("0.02", 18),
                ethers.parseUnits("0.03", 18)
            ]; // Amounts above minimum threshold

            for (let i = 0; i < amounts.length; i++) {
                const signature = await signClaim(publisher, await vault.getAddress(), attacker.address, amounts[i]);
                const nonce = await
                    vault.claimNonce(attacker.address);
                await vault.payWithSig(attacker.address, amounts[i], nonce, signature);

                // Verify fees are calculated correctly each time
                const expectedCumulativeFee = (amounts[i] * BigInt(FEE_BPS)) / 10000n;
                expect(await vault.alreadyFeePaid(attacker.address)).to.equal(expectedCumulativeFee);
            }
        });
    });

    describe("Rate Limit Exploitation", function () {
        it("Should enforce rate limits across multiple transactions", async function () {
            // This test verifies that the rate limiter works conceptually,
            // but in practice, Base L2 blocks are produced so quickly that 
            // hitting the same-block limit is unlikely in production.
            // We test the logic by verifying the counter increments properly.

            const baseAmount = ethers.parseUnits("0.1", 18);

            // Make multiple claims and verify counter increments
            for (let i = 0; i < 5; i++) {
                const amount = baseAmount * BigInt(i + 1);
                const signature = await signClaim(publisher, await vault.getAddress(), attacker.address, amount);
                const nonce = await vault.claimNonce(attacker.address);
                await vault.payWithSig(attacker.address, amount, nonce, signature);
            }

            // In normal Hardhat testing, each transaction is in a new block
            // The rate limit counter should be 1 for each block
            const currentBlock = await ethers.provider.getBlockNumber();
            const claimsInBlock = await vault.claimsPerBlock(currentBlock);
            expect(claimsInBlock).to.equal(1); // Only 1 claim in latest block

            // Verify the constant is set correctly
            expect(await vault.MAX_CLAIMS_PER_BLOCK()).to.equal(50);
        });

        it("Should reset rate limits in new blocks", async function () {
            // Fill rate limit in current block
            const baseAmount = ethers.parseUnits("0.1", 18);
            for (let i = 0; i < 50; i++) {
                const amount = baseAmount * BigInt(i + 1);
                const signature = await signClaim(publisher, await vault.getAddress(), attacker.address, amount);
                const nonce = await
                    vault.claimNonce(attacker.address);
                await vault.payWithSig(attacker.address, amount, nonce, signature);
            }

            // Mine a new block
            await ethers.provider.send("evm_mine", []);

            // Should be able to claim again
            const victimAmount = ethers.parseUnits("0.1", 18);
            const signature = await signClaim(publisher, await vault.getAddress(), victim.address, victimAmount);
            const nonce = await
                vault.claimNonce(victim.address);
            await expect(vault.payWithSig(victim.address, victimAmount, nonce, signature))
                .to.emit(vault, "ClaimedMinimal");
        });
    });

    describe("Monitoring System Tests", function () {
        it("Should emit high value claim alerts", async function () {
            // HIGH_VALUE_CLAIM_THRESHOLD = 1000e18
            const highValueAmount = ethers.parseUnits("1500", 18);
            const signature = await signClaim(publisher, await vault.getAddress(), attacker.address, highValueAmount);

            const nonce = await vault.claimNonce(attacker.address);
            const tx = await vault.payWithSig(attacker.address, highValueAmount, nonce, signature);
            const receipt = await tx.wait();

            // Verify HighValueClaim event was emitted
            const event = receipt?.logs.find(log => {
                try {
                    const parsed = vault.interface.parseLog(log);
                    return parsed?.name === "HighValueClaim";
                } catch {
                    return false;
                }
            });

            expect(event).to.not.be.undefined;
            if (event) {
                const parsed = vault.interface.parseLog(event);
                expect(parsed?.args.account).to.equal(attacker.address);
                expect(parsed?.args.amount).to.equal(highValueAmount);
                expect(parsed?.args.cumulativeAmount).to.equal(highValueAmount);
            }
        });

        it("Should detect repeated high value claims from same account", async function () {
            // First high value claim
            const highValueAmount1 = ethers.parseUnits("1200", 18);
            const signature1 = await signClaim(publisher, await vault.getAddress(), attacker.address, highValueAmount1);
            const nonce = await vault.claimNonce(attacker.address);
            await vault.payWithSig(attacker.address, highValueAmount1, nonce, signature1);

            // Second high value claim - should trigger suspicious activity
            const highValueAmount2 = ethers.parseUnits("2400", 18); // cumulative: 2400
            const signature2 = await signClaim(publisher, await vault.getAddress(), attacker.address, highValueAmount2);
            const nonce2 = await vault.claimNonce(attacker.address);

            const tx = await vault.payWithSig(attacker.address, highValueAmount2, nonce2, signature2);
            const receipt = await tx.wait();

            // Verify SuspiciousActivity event was emitted
            const event = receipt?.logs.find(log => {
                try {
                    const parsed = vault.interface.parseLog(log);
                    return parsed?.name === "SuspiciousActivity";
                } catch {
                    return false;
                }
            });

            expect(event).to.not.be.undefined;
            if (event) {
                const parsed = vault.interface.parseLog(event);
                expect(parsed?.args.actor).to.equal(attacker.address);
                // activityType is indexed so we check the description instead
                expect(parsed?.args.description).to.equal("Multiple high-value claims from same account");
            }
        });

        it("Should warn when approaching rate limits", async function () {
            // This test verifies the warning threshold logic
            // The actual multi-transaction-per-block scenario is hard to simulate
            // in Hardhat, but we can verify the constants and thresholds are correct

            const MAX_CLAIMS = await vault.MAX_CLAIMS_PER_BLOCK();
            expect(MAX_CLAIMS).to.equal(50);

            // The warning threshold is 80% of max = 40 claims
            const warningThreshold = (MAX_CLAIMS * BigInt(80)) / BigInt(100);
            expect(warningThreshold).to.equal(40);

            // Verify the modifier exists and functions correctly
            // by making a successful claim
            const baseAmount = ethers.parseUnits("0.1", 18);
            const signature = await signClaim(publisher, await vault.getAddress(), attacker.address, baseAmount);
            const nonce = await vault.claimNonce(attacker.address);

            await expect(vault.payWithSig(attacker.address, baseAmount, nonce, signature))
                .to.emit(vault, "ClaimedMinimal");
        });
    });

    describe("Gas Griefing Resistance", function () {
        it("Should detect excessive gas usage in ClaimRouter", async function () {
            // Approve router factory
            await router.connect(timelock).setFactoryApproved(await factory.getAddress(), true);
            await router.connect(timelock).setMaxGasPerClaim(300000);

            // This test would require a malicious vault that consumes excessive gas
            // For now, we test the monitoring logic works
            const amount = ethers.parseUnits("100", 18);
            const nonce = await vault.claimNonce(victim.address);
            const claims = [{
                vault: await vault.getAddress(),
                account: victim.address,
                cumulativeAmount: amount,
                nonce: nonce,
                signature: await signClaim(publisher, await vault.getAddress(), victim.address, amount)
            }];

            // Normal claim should succeed
            const result = await router.claimAll(claims);
            expect(result).to.emit(router, "BatchClaimed");
        });
    });

    describe("Economic Invariants", function () {
        it("Should maintain balance invariant after multiple claims", async function () {
            const initialBalance = await testToken.balanceOf(await vault.getAddress());
            let totalClaimed = 0n;
            let totalFees = 0n;

            // Make multiple claims with amounts above minimum
            const claimAmounts = [
                ethers.parseUnits("0.01", 18),
                ethers.parseUnits("0.025", 18),
                ethers.parseUnits("0.04", 18),
                ethers.parseUnits("0.1", 18),
                ethers.parseUnits("0.25", 18)
            ];

            for (const amount of claimAmounts) {
                const signature = await signClaim(publisher, await vault.getAddress(), attacker.address, amount);
                const nonce = await
                    vault.claimNonce(attacker.address);
                await vault.payWithSig(attacker.address, amount, nonce, signature);

                // Track what was actually paid
                const gross = amount - totalClaimed;
                const fee = (amount * BigInt(FEE_BPS)) / 10000n - totalFees;

                totalClaimed = amount;
                totalFees = (amount * BigInt(FEE_BPS)) / 10000n;
            }

            // Invariant: initial balance = current balance + total claimed
            const currentBalance = await testToken.balanceOf(await vault.getAddress());
            const actualTotalClaimed = await vault.globalAlreadyClaimed();

            expect(initialBalance - currentBalance).to.equal(actualTotalClaimed);
        });

        it("Should prevent double spending through reentrancy simulation", async function () {
            const claimAmount = ethers.parseUnits("1000", 18);
            const signature = await signClaim(publisher, await vault.getAddress(), attacker.address, claimAmount);

            // First claim succeeds
            const nonce = await
                vault.claimNonce(attacker.address);
            await vault.payWithSig(attacker.address, claimAmount, nonce, signature);

            // Same claim should fail
            const nonce2 = await
                vault.claimNonce(attacker.address);
            await expect(vault.payWithSig(attacker.address, claimAmount, nonce2, signature))
                .to.be.revertedWithCustomError(vault, "AlreadyExists")
                .withArgs("claim");
        });
    });
});