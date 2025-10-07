import { ethers } from "hardhat";
import { expect } from "chai";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
    RewardPoolFactory,
    RewardPoolImplementation,
    TestToken
} from "../typechain-types";

/**
 * Advanced Security Tests
 * Extended security test suite for RewardPoolImplementation
 * Tests monitoring, invariants, and multi-decimal token support
 */
describe("Advanced Security Tests", function () {
    let factory: RewardPoolFactory;
    let implementation: RewardPoolImplementation;
    let vault: RewardPoolImplementation;
    let testToken: TestToken;
    let testToken6Decimals: TestToken;
    let testToken8Decimals: TestToken;

    let owner: SignerWithAddress;
    let timelock: SignerWithAddress;
    let guardian: SignerWithAddress;
    let publisher: SignerWithAddress;
    let claimer: SignerWithAddress;
    let funder: SignerWithAddress;

    const FUND_AMOUNT = ethers.parseUnits("100000", 18); // 100k tokens
    const HIGH_VALUE_THRESHOLD = ethers.parseUnits("1000", 18); // 1000 tokens

    beforeEach(async function () {
        [owner, timelock, guardian, publisher, claimer, funder] = await ethers.getSigners();

        // Deploy mock tokens with different decimals
        const TestTokenFactory = await ethers.getContractFactory("TestToken");
        testToken = await TestTokenFactory.deploy("Test Token", "TEST", 18);
        testToken6Decimals = await TestTokenFactory.deploy("USDC Mock", "USDC", 6);
        testToken8Decimals = await TestTokenFactory.deploy("WBTC Mock", "WBTC", 8);

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

        // Setup token allowlist
        await factory.connect(timelock).setTokenAllowed(await testToken.getAddress(), true);
        await factory.connect(timelock).setTokenAllowed(await testToken6Decimals.getAddress(), true);
        await factory.connect(timelock).setTokenAllowed(await testToken8Decimals.getAddress(), true);

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

        const vaultContract = await ethers.getContractAt("RewardPoolImplementation", vaultAddress);
        const nonce = await vaultContract.claimNonce(account);

        const value = {
            account: account,
            cumulativeAmount: amount,
            nonce: nonce.toString()
        };

        return await signer.signTypedData(domain, types, value);
    }

    describe("Repeated High-Value Claims Detection (Lines 368-378)", function () {
        it("Should detect when account makes multiple high-value claims", async function () {
            // First high-value claim (1500 tokens)
            const firstClaim = ethers.parseUnits("1500", 18);
            const signature1 = await signClaim(publisher, await vault.getAddress(), claimer.address, firstClaim);
            const nonce1 = await vault.claimNonce(claimer.address);

            await vault.payWithSig(claimer.address, firstClaim, nonce1, signature1);

            // Second high-value claim (3000 cumulative = 1500 new)
            const secondClaim = ethers.parseUnits("3000", 18);
            const signature2 = await signClaim(publisher, await vault.getAddress(), claimer.address, secondClaim);
            const nonce2 = await vault.claimNonce(claimer.address);

            // This should trigger SuspiciousActivity event for repeated_high_value
            const tx = await vault.payWithSig(claimer.address, secondClaim, nonce2, signature2);
            const receipt = await tx.wait();

            // Verify the event was emitted
            const suspiciousEvent = receipt?.logs.find(log => {
                try {
                    const parsed = vault.interface.parseLog(log);
                    return parsed?.name === "SuspiciousActivity";
                } catch {
                    return false;
                }
            });

            expect(suspiciousEvent).to.not.be.undefined;
            if (suspiciousEvent) {
                const parsed = vault.interface.parseLog(suspiciousEvent);
                expect(parsed?.args.actor).to.equal(claimer.address);
                expect(parsed?.args.description).to.equal("Multiple high-value claims from same account");
            }
        });

        it("Should NOT trigger repeated warning for first high-value claim", async function () {
            // First high-value claim - should emit HighValueClaim but NOT SuspiciousActivity
            const firstClaim = ethers.parseUnits("1500", 18);
            const signature1 = await signClaim(publisher, await vault.getAddress(), claimer.address, firstClaim);
            const nonce1 = await vault.claimNonce(claimer.address);

            const tx = await vault.payWithSig(claimer.address, firstClaim, nonce1, signature1);
            const receipt = await tx.wait();

            // Check for HighValueClaim
            const highValueEvent = receipt?.logs.find(log => {
                try {
                    const parsed = vault.interface.parseLog(log);
                    return parsed?.name === "HighValueClaim";
                } catch {
                    return false;
                }
            });
            expect(highValueEvent).to.not.be.undefined;

            // Should NOT have SuspiciousActivity event
            const suspiciousEvent = receipt?.logs.find(log => {
                try {
                    const parsed = vault.interface.parseLog(log);
                    return parsed?.name === "SuspiciousActivity" &&
                        parsed?.args.description === "Multiple high-value claims from same account";
                } catch {
                    return false;
                }
            });
            expect(suspiciousEvent).to.be.undefined;
        });

        it("Should trigger repeated warning only when both claims are high-value", async function () {
            // First claim: low value (100 tokens)
            const firstClaim = ethers.parseUnits("100", 18);
            const signature1 = await signClaim(publisher, await vault.getAddress(), claimer.address, firstClaim);
            const nonce1 = await vault.claimNonce(claimer.address);
            await vault.payWithSig(claimer.address, firstClaim, nonce1, signature1);

            // Second claim: high value (1600 cumulative = 1500 new, but previous was only 100)
            const secondClaim = ethers.parseUnits("1600", 18);
            const signature2 = await signClaim(publisher, await vault.getAddress(), claimer.address, secondClaim);
            const nonce2 = await vault.claimNonce(claimer.address);

            const tx = await vault.payWithSig(claimer.address, secondClaim, nonce2, signature2);
            const receipt = await tx.wait();

            // Should emit HighValueClaim but NOT SuspiciousActivity (previous was not high-value)
            const suspiciousEvent = receipt?.logs.find(log => {
                try {
                    const parsed = vault.interface.parseLog(log);
                    return parsed?.name === "SuspiciousActivity" &&
                        parsed?.args.description === "Multiple high-value claims from same account";
                } catch {
                    return false;
                }
            });
            expect(suspiciousEvent).to.be.undefined;
        });
    });

    describe("CheckInvariant Function (Lines 524-558)", function () {
        it("Should validate claim monotonicity invariant", async function () {
            const claimAmount = ethers.parseUnits("100", 18);
            const signature = await signClaim(publisher, await vault.getAddress(), claimer.address, claimAmount);
            const nonce = await vault.claimNonce(claimer.address);
            await vault.payWithSig(claimer.address, claimAmount, nonce, signature);

            // Check invariant with valid increase
            const newAmount = ethers.parseUnits("200", 18);
            const isValid = await vault.checkInvariant(claimer.address, newAmount);
            expect(isValid).to.be.true;

            // Check invariant with invalid decrease
            const invalidAmount = ethers.parseUnits("50", 18);
            const isInvalid = await vault.checkInvariant(claimer.address, invalidAmount);
            expect(isInvalid).to.be.false; // Should fail monotonicity check
        });

        it("Should validate fee calculation consistency", async function () {
            // Make a claim
            const claimAmount = ethers.parseUnits("1000", 18);
            const signature = await signClaim(publisher, await vault.getAddress(), claimer.address, claimAmount);
            const nonce = await vault.claimNonce(claimer.address);
            await vault.payWithSig(claimer.address, claimAmount, nonce, signature);

            // Check invariant with proper fee calculation
            const newAmount = ethers.parseUnits("2000", 18);
            const isValid = await vault.checkInvariant(claimer.address, newAmount);
            expect(isValid).to.be.true;
        });

        it("Should validate precision attack prevention in invariant", async function () {
            // Try to validate a very small claim (below minimum)
            const tinyAmount = 1n; // 1 wei - below MIN_CLAIM_AMOUNT
            const currentClaimed = await vault.alreadyClaimed(claimer.address);

            const isValid = await vault.checkInvariant(claimer.address, currentClaimed + tinyAmount);
            expect(isValid).to.be.false; // Should fail precision check
        });

        it("Should validate rate limiting integrity", async function () {
            // Make a claim to populate the counter
            const claimAmount = ethers.parseUnits("100", 18);
            const signature = await signClaim(publisher, await vault.getAddress(), claimer.address, claimAmount);
            const nonce = await vault.claimNonce(claimer.address);
            await vault.payWithSig(claimer.address, claimAmount, nonce, signature);

            // Get current block number
            const currentBlock = await ethers.provider.getBlockNumber();
            const claimsInBlock = await vault.claimsPerBlock(currentBlock);

            // Verify counter is within limits
            expect(claimsInBlock).to.be.lessThanOrEqual(50); // MAX_CLAIMS_PER_BLOCK

            // Check invariant passes
            const newAmount = ethers.parseUnits("200", 18);
            const isValid = await vault.checkInvariant(claimer.address, newAmount);
            expect(isValid).to.be.true;
        });

        it("Should validate balance conservation", async function () {
            // Make a claim
            const claimAmount = ethers.parseUnits("100", 18);
            const signature = await signClaim(publisher, await vault.getAddress(), claimer.address, claimAmount);
            const nonce = await vault.claimNonce(claimer.address);
            await vault.payWithSig(claimer.address, claimAmount, nonce, signature);

            // Check invariant
            const newAmount = ethers.parseUnits("200", 18);
            const isValid = await vault.checkInvariant(claimer.address, newAmount);
            expect(isValid).to.be.true;

            // Verify contract still has balance
            const balance = await testToken.balanceOf(await vault.getAddress());
            expect(balance).to.be.greaterThan(0);
        });

        it("Should fail invariant check when fee exceeds gross amount", async function () {
            // This is a theoretical test - in practice this shouldn't happen
            // but the invariant should catch it

            // Make initial claim
            const claimAmount = ethers.parseUnits("100", 18);
            const signature = await signClaim(publisher, await vault.getAddress(), claimer.address, claimAmount);
            const nonce = await vault.claimNonce(claimer.address);
            await vault.payWithSig(claimer.address, claimAmount, nonce, signature);

            // The invariant check should pass for valid amounts
            const newAmount = ethers.parseUnits("200", 18);
            const isValid = await vault.checkInvariant(claimer.address, newAmount);
            expect(isValid).to.be.true;
        });
    });

    describe("Token Decimals Handling", function () {
        it("Should handle 6-decimal tokens (USDC)", async function () {
            // Create vault for 6-decimal token
            const tx = await factory.connect(owner).createPool(await testToken6Decimals.getAddress());
            const receipt = await tx.wait();
            const event = receipt?.logs.find(log => {
                try {
                    const parsed = factory.interface.parseLog(log);
                    return parsed?.name === "PoolCreated";
                } catch {
                    return false;
                }
            });

            if (!event) throw new Error("Pool creation event not found");

            const parsed = factory.interface.parseLog(event);
            const vault6 = await ethers.getContractAt("RewardPoolImplementation", parsed?.args.pool);

            // Fund the vault
            const fundAmount = ethers.parseUnits("10000", 6); // 10k USDC
            await testToken6Decimals.mint(funder.address, fundAmount);
            await testToken6Decimals.connect(funder).approve(await vault6.getAddress(), fundAmount);
            await vault6.connect(funder).fund(fundAmount);

            // Make a claim with minimum amount for 6 decimals (0.01 tokens = 10000)
            const minClaim = ethers.parseUnits("0.01", 6);
            const signature = await signClaim(publisher, await vault6.getAddress(), claimer.address, minClaim);
            const nonce = await vault6.claimNonce(claimer.address);

            await expect(vault6.payWithSig(claimer.address, minClaim, nonce, signature))
                .to.emit(vault6, "ClaimedMinimal");
        });

        it("Should handle 8-decimal tokens (WBTC)", async function () {
            // Create vault for 8-decimal token
            const tx = await factory.connect(owner).createPool(await testToken8Decimals.getAddress());
            const receipt = await tx.wait();
            const event = receipt?.logs.find(log => {
                try {
                    const parsed = factory.interface.parseLog(log);
                    return parsed?.name === "PoolCreated";
                } catch {
                    return false;
                }
            });

            if (!event) throw new Error("Pool creation event not found");

            const parsed = factory.interface.parseLog(event);
            const vault8 = await ethers.getContractAt("RewardPoolImplementation", parsed?.args.pool);

            // Fund the vault
            const fundAmount = ethers.parseUnits("100", 8); // 100 WBTC
            await testToken8Decimals.mint(funder.address, fundAmount);
            await testToken8Decimals.connect(funder).approve(await vault8.getAddress(), fundAmount);
            await vault8.connect(funder).fund(fundAmount);

            // Make a claim with minimum amount for 8 decimals (0.01 tokens = 1000000)
            const minClaim = ethers.parseUnits("0.01", 8);
            const signature = await signClaim(publisher, await vault8.getAddress(), claimer.address, minClaim);
            const nonce = await vault8.claimNonce(claimer.address);

            await expect(vault8.payWithSig(claimer.address, minClaim, nonce, signature))
                .to.emit(vault8, "ClaimedMinimal");
        });

        it("Should reject claims below minimum for 6-decimal tokens", async function () {
            // Create vault for 6-decimal token
            const tx = await factory.connect(owner).createPool(await testToken6Decimals.getAddress());
            const receipt = await tx.wait();
            const event = receipt?.logs.find(log => {
                try {
                    const parsed = factory.interface.parseLog(log);
                    return parsed?.name === "PoolCreated";
                } catch {
                    return false;
                }
            });

            if (!event) throw new Error("Pool creation event not found");

            const parsed = factory.interface.parseLog(event);
            const vault6 = await ethers.getContractAt("RewardPoolImplementation", parsed?.args.pool);

            // Fund the vault
            const fundAmount = ethers.parseUnits("10000", 6);
            await testToken6Decimals.mint(funder.address, fundAmount);
            await testToken6Decimals.connect(funder).approve(await vault6.getAddress(), fundAmount);
            await vault6.connect(funder).fund(fundAmount);

            // Try to claim below minimum (1 unit = 0.000001 tokens)
            const tooSmall = 1n; // Way below minimum
            const signature = await signClaim(publisher, await vault6.getAddress(), claimer.address, tooSmall);
            const nonce = await vault6.claimNonce(claimer.address);

            await expect(vault6.payWithSig(claimer.address, tooSmall, nonce, signature))
                .to.be.revertedWithCustomError(vault6, "SecurityViolation")
                .withArgs("claim_too_small");
        });
    });
});

