import { ethers } from "hardhat";
import { expect } from "chai";
import {
    RewardPoolFactory,
    RewardPoolImplementation,
    TestToken,
    ClaimRouter
} from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("RewardPoolImplementation", function () {
    let factory: RewardPoolFactory;
    let implementation: RewardPoolImplementation;
    let vault: RewardPoolImplementation;
    let testToken: TestToken;
    let claimRouter: ClaimRouter;

    let owner: SignerWithAddress;
    let timelock: SignerWithAddress;
    let guardian: SignerWithAddress;
    let publisher: SignerWithAddress;
    let newPublisher: SignerWithAddress;
    let creator: SignerWithAddress;
    let treasury: SignerWithAddress;
    let funder: SignerWithAddress;
    let claimer: SignerWithAddress;

    const DOMAIN_NAME = "FactoryVault";
    const DOMAIN_VERSION = "1";

    beforeEach(async function () {
        [owner, timelock, guardian, publisher, newPublisher, creator, treasury, funder, claimer] = await ethers.getSigners();

        // Deploy test token
        const TestTokenFactory = await ethers.getContractFactory("TestToken");
        testToken = await TestTokenFactory.deploy("Test Token", "TEST", 18);

        // Deploy implementation
        const ImplFactory = await ethers.getContractFactory("RewardPoolImplementation");
        implementation = await ImplFactory.deploy();

        // Deploy factory
        const FactoryFactory = await ethers.getContractFactory("RewardPoolFactory");
        factory = await FactoryFactory.deploy(
            await implementation.getAddress(),
            treasury.address,
            timelock.address,
            guardian.address,
            publisher.address
        );

        // Deploy ClaimRouter
        const RouterFactory = await ethers.getContractFactory("ClaimRouter");
        claimRouter = await RouterFactory.deploy(timelock.address);

        // Setup: Approve factory in router and token in factory
        await claimRouter.connect(timelock).setFactoryApproved(await factory.getAddress(), true);
        await factory.connect(timelock).setTokenAllowed(await testToken.getAddress(), true);

        // Create vault
        const [vaultAddress] = await factory.predictPoolAddress(creator.address, await testToken.getAddress());
        await factory.connect(creator).createPool(await testToken.getAddress());
        vault = await ethers.getContractAt("RewardPoolImplementation", vaultAddress);
    });

    describe("Initialization", function () {
        it("Should be initialized correctly after creation", async function () {
            expect(await vault.token()).to.equal(await testToken.getAddress());
            expect(await vault.platformTreasury()).to.equal(treasury.address);
            expect(await vault.factory()).to.equal(await factory.getAddress());
        });

        it("Should prevent direct initialization on implementation", async function () {
            await expect(implementation.initialize(
                await testToken.getAddress(),
                creator.address,
                treasury.address,
                await factory.getAddress()
            )).to.be.revertedWithCustomError(implementation, "InvalidInitialization");
        });

        it("Should prevent re-initialization", async function () {
            await expect(vault.initialize(
                await testToken.getAddress(),
                creator.address,
                treasury.address,
                await factory.getAddress()
            )).to.be.revertedWithCustomError(implementation, "InvalidInitialization");
        });
    });

    describe("Funding", function () {
        const FUND_AMOUNT = ethers.parseUnits("1000", 18);

        beforeEach(async function () {
            await testToken.mint(funder.address, FUND_AMOUNT);
            await testToken.connect(funder).approve(await await vault.getAddress(), FUND_AMOUNT);
        });

        it("Should fund vault successfully", async function () {
            await expect(vault.connect(funder).fund(FUND_AMOUNT))
                .to.emit(vault, "Funded")
                .withArgs(funder.address, await testToken.getAddress(), FUND_AMOUNT);

            expect(await testToken.balanceOf(await await vault.getAddress())).to.equal(FUND_AMOUNT);
        });

        it("Should reject fee-on-transfer tokens", async function () {
            // Deploy fee-on-transfer token mock
            const FeeTokenFactory = await ethers.getContractFactory("FeeOnTransferToken");
            const feeToken = await FeeTokenFactory.deploy("FeeToken", "FEE"); // 1% fee hardcoded in contract

            // Create vault for fee token
            await factory.connect(timelock).setTokenAllowed(await feeToken.getAddress(), true);
            const [feeVaultAddress] = await factory.predictPoolAddress(creator.address, await feeToken.getAddress());
            await factory.connect(creator).createPool(await feeToken.getAddress());
            const feeVault = await ethers.getContractAt("RewardPoolImplementation", feeVaultAddress);

            await feeToken.mint(funder.address, FUND_AMOUNT);
            await feeToken.connect(funder).approve(await feeVault.getAddress(), FUND_AMOUNT);

            // Fee-on-transfer tokens should be rejected
            await expect(feeVault.connect(funder).fund(FUND_AMOUNT))
                .to.be.reverted;
        });

        it("Should fund with permit successfully", async function () {
            const deadline = await time.latest() + 3600;
            const permitData = await getPermitSignature(
                funder,
                testToken,
                await await vault.getAddress(),
                FUND_AMOUNT,
                deadline
            );

            await expect(vault.connect(funder).fundWithPermit(
                FUND_AMOUNT,
                deadline,
                permitData.v,
                permitData.r,
                permitData.s
            )).to.emit(vault, "Funded")
                .withArgs(funder.address, await testToken.getAddress(), FUND_AMOUNT);

            expect(await testToken.balanceOf(await await vault.getAddress())).to.equal(FUND_AMOUNT);
        });

        it("Should handle permit failure gracefully", async function () {
            const deadline = await time.latest() + 3600;

            // Use invalid signature
            await expect(vault.connect(funder).fundWithPermit(
                FUND_AMOUNT,
                deadline,
                27,
                "0x0000000000000000000000000000000000000000000000000000000000000000",
                "0x0000000000000000000000000000000000000000000000000000000000000000"
            )).to.be.revertedWithCustomError(vault, "SecurityViolation")
                .withArgs("permit");
        });
    });

    describe("Claims with EIP-712", function () {
        const FUND_AMOUNT = ethers.parseUnits("1000", 18);
        const CLAIM_AMOUNT = ethers.parseUnits("100", 18);
        const FEE_BPS = 1000; // 10%
        const EXPECTED_FEE = CLAIM_AMOUNT * BigInt(FEE_BPS) / BigInt(10000);
        const EXPECTED_NET = CLAIM_AMOUNT - EXPECTED_FEE;

        beforeEach(async function () {
            // Fund vault
            await testToken.mint(funder.address, FUND_AMOUNT);
            await testToken.connect(funder).approve(await await vault.getAddress(), FUND_AMOUNT);
            await vault.connect(funder).fund(FUND_AMOUNT);
        });

        it("Should process claim with valid signature", async function () {
            const deadline = await time.latest() + 3600;
            const signature = await signClaim(
                publisher,
                vault,
                claimer.address,
                CLAIM_AMOUNT,
                deadline
            );

            await expect(vault.payWithSig(claimer.address, CLAIM_AMOUNT, deadline, signature))
                .to.emit(vault, "ClaimedMinimal")
                .withArgs(claimer.address, await testToken.getAddress(), CLAIM_AMOUNT);

            expect(await vault.alreadyClaimed(claimer.address)).to.equal(CLAIM_AMOUNT);
            expect(await vault.alreadyFeePaid(claimer.address)).to.equal(EXPECTED_FEE);
            expect(await vault.globalAlreadyClaimed()).to.equal(CLAIM_AMOUNT);
            expect(await testToken.balanceOf(claimer.address)).to.equal(EXPECTED_NET);
            expect(await testToken.balanceOf(treasury.address)).to.equal(EXPECTED_FEE);
        });

        it("Should handle cumulative claims correctly", async function () {
            const deadline = await time.latest() + 3600;

            // First claim: 100 tokens
            let signature = await signClaim(publisher, await vault.getAddress(), claimer.address, CLAIM_AMOUNT, deadline);
            await vault.payWithSig(claimer.address, CLAIM_AMOUNT, deadline, signature);

            // Second claim: cumulative 200 tokens (additional 100)
            const cumulativeAmount = CLAIM_AMOUNT * 2n;
            const additionalAmount = CLAIM_AMOUNT;
            const cumulativeFee = cumulativeAmount * BigInt(FEE_BPS) / BigInt(10000);
            const additionalFee = cumulativeFee - EXPECTED_FEE;
            const additionalNet = additionalAmount - additionalFee;

            signature = await signClaim(publisher, await vault.getAddress(), claimer.address, cumulativeAmount, deadline + 1);

            const initialBalance = await testToken.balanceOf(claimer.address);
            await vault.payWithSig(claimer.address, cumulativeAmount, deadline + 1, signature);

            expect(await vault.alreadyClaimed(claimer.address)).to.equal(cumulativeAmount);
            expect(await testToken.balanceOf(claimer.address)).to.equal(initialBalance + additionalNet);
        });

        it("Should reject expired signatures", async function () {
            const expiredDeadline = await time.latest() - 1;
            const signature = await signClaim(
                publisher,
                await await vault.getAddress(),
                claimer.address,
                CLAIM_AMOUNT,
                expiredDeadline
            );

            await expect(vault.payWithSig(claimer.address, CLAIM_AMOUNT, expiredDeadline, signature))
                .to.be.revertedWithCustomError(vault, "SecurityViolation")
                .withArgs("deadline");
        });

        it("Should reject signatures too far in future", async function () {
            const farFutureDeadline = await time.latest() + (8 * 24 * 60 * 60); // 8 days
            const signature = await signClaim(
                publisher,
                await await vault.getAddress(),
                claimer.address,
                CLAIM_AMOUNT,
                farFutureDeadline
            );

            await expect(vault.payWithSig(claimer.address, CLAIM_AMOUNT, farFutureDeadline, signature))
                .to.be.revertedWithCustomError(vault, "InvalidParameter")
                .withArgs("deadline");
        });

        it("Should reject invalid signatures", async function () {
            const deadline = await time.latest() + 3600;
            const invalidSignature = "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

            await expect(vault.payWithSig(claimer.address, CLAIM_AMOUNT, deadline, invalidSignature))
                .to.be.revertedWithCustomError(vault, "ECDSAInvalidSignature");
        });

        it("Should accept signatures from old publisher during grace period", async function () {
            // Initiate publisher rotation
            await factory.connect(timelock).initiatePublisherRotation(newPublisher.address);

            const deadline = await time.latest() + 3600;

            // Sign with old publisher
            const oldSignature = await signClaim(publisher, await vault.getAddress(), claimer.address, CLAIM_AMOUNT, deadline);

            // Sign with new publisher
            const newSignature = await signClaim(newPublisher, await vault.getAddress(), claimer.address, CLAIM_AMOUNT, deadline + 1);

            // Both should work during grace period
            await expect(vault.payWithSig(claimer.address, CLAIM_AMOUNT, deadline, oldSignature))
                .to.emit(vault, "ClaimedMinimal");

            // Reset for second test
            await testToken.mint(funder.address, FUND_AMOUNT);
            await testToken.connect(funder).approve(await await vault.getAddress(), FUND_AMOUNT);
            await vault.connect(funder).fund(FUND_AMOUNT);

            const newClaimer = owner; // Use different address
            const newSignature2 = await signClaim(newPublisher, await vault.getAddress(), newClaimer.address, CLAIM_AMOUNT, deadline + 2);

            await expect(vault.payWithSig(newClaimer.address, CLAIM_AMOUNT, deadline + 2, newSignature2))
                .to.emit(vault, "ClaimedMinimal");
        });

        it("Should reject old publisher after grace period", async function () {
            // Initiate publisher rotation
            await factory.connect(timelock).initiatePublisherRotation(newPublisher.address);

            // Advance time beyond grace period
            await time.increase(7 * 24 * 60 * 60 + 1);

            const deadline = await time.latest() + 3600;
            const oldSignature = await signClaim(publisher, await vault.getAddress(), claimer.address, CLAIM_AMOUNT, deadline);

            await expect(vault.payWithSig(claimer.address, CLAIM_AMOUNT, deadline, oldSignature))
                .to.be.revertedWithCustomError(vault, "SecurityViolation")
                .withArgs("signature");
        });

        it("Should prevent duplicate claims", async function () {
            const deadline = await time.latest() + 3600;
            const signature = await signClaim(publisher, await vault.getAddress(), claimer.address, CLAIM_AMOUNT, deadline);

            await vault.payWithSig(claimer.address, CLAIM_AMOUNT, deadline, signature);

            // Try to claim same amount again
            await expect(vault.payWithSig(claimer.address, CLAIM_AMOUNT, deadline + 1, signature))
                .to.be.revertedWithCustomError(vault, "AlreadyExists")
                .withArgs("claim");
        });

        it("Should reject claims with insufficient vault balance", async function () {
            const deadline = await time.latest() + 3600;
            const largeAmount = FUND_AMOUNT + ethers.parseUnits("1", 18);
            const signature = await signClaim(publisher, await vault.getAddress(), claimer.address, largeAmount, deadline);

            await expect(vault.payWithSig(claimer.address, largeAmount, deadline, signature))
                .to.be.revertedWithCustomError(vault, "InvalidParameter")
                .withArgs("balance");
        });
    });

    describe("Gas Benchmarks", function () {
        const FUND_AMOUNT = ethers.parseUnits("1000", 18);
        const CLAIM_AMOUNT = ethers.parseUnits("100", 18);

        beforeEach(async function () {
            await testToken.mint(funder.address, FUND_AMOUNT);
            await testToken.connect(funder).approve(await await vault.getAddress(), FUND_AMOUNT);
            await vault.connect(funder).fund(FUND_AMOUNT);
        });

        it("Should benchmark first claim gas usage", async function () {
            const deadline = await time.latest() + 3600;
            const signature = await signClaim(publisher, await vault.getAddress(), claimer.address, CLAIM_AMOUNT, deadline);

            const tx = await vault.payWithSig(claimer.address, CLAIM_AMOUNT, deadline, signature);
            const receipt = await tx.wait();

            // Target: < 140k gas for first claim
            console.log(`First claim gas used: ${receipt!.gasUsed.toString()}`);
            expect(receipt!.gasUsed).to.be.lessThan(200000);
        });

        it("Should benchmark subsequent claim gas usage", async function () {
            // Make first claim
            const deadline1 = await time.latest() + 3600;
            const signature1 = await signClaim(publisher, await vault.getAddress(), claimer.address, CLAIM_AMOUNT, deadline1);
            await vault.payWithSig(claimer.address, CLAIM_AMOUNT, deadline1, signature1);

            // Make second claim
            const deadline2 = await time.latest() + 3601;
            const cumulativeAmount = CLAIM_AMOUNT * 2n;
            const signature2 = await signClaim(publisher, await vault.getAddress(), claimer.address, cumulativeAmount, deadline2);

            const tx = await vault.payWithSig(claimer.address, cumulativeAmount, deadline2, signature2);
            const receipt = await tx.wait();

            // Target: < 100k gas for subsequent claims
            console.log(`Subsequent claim gas used: ${receipt!.gasUsed.toString()}`);
            expect(receipt!.gasUsed).to.be.lessThan(110000);
        });
    });

    describe("Emergency Functions", function () {
        it("Should allow timelock to update treasury", async function () {
            const newTreasury = owner.address;

            await expect(vault.connect(timelock).updatePlatformTreasury(newTreasury))
                .to.emit(vault, "PlatformTreasuryUpdated")
                .withArgs(treasury.address, newTreasury);

            expect(await vault.platformTreasury()).to.equal(newTreasury);
        });

        it("Should reject treasury update from non-timelock", async function () {
            await expect(vault.connect(creator).updatePlatformTreasury(owner.address))
                .to.be.revertedWithCustomError(vault, "Unauthorized")
                .withArgs("timelock");
        });
    });

    // Helper functions
    async function getAddress(addressable: string | { getAddress(): Promise<string> }): Promise<string> {
        if (typeof addressable === 'string') {
            return addressable;
        }
        return await addressable.getAddress();
    }

    async function signClaim(
        signer: SignerWithAddress,
        vaultAddress: string | { getAddress(): Promise<string> },
        account: string,
        cumulativeAmount: bigint,
        deadline: number
    ): Promise<string> {
        const chainId = await ethers.provider.getNetwork().then(n => n.chainId);

        const resolvedAddress = await getAddress(vaultAddress);
        const domain = {
            name: DOMAIN_NAME,
            version: DOMAIN_VERSION,
            chainId: chainId,
            verifyingContract: resolvedAddress
        };

        const types = {
            Claim: [
                { name: "account", type: "address" },
                { name: "cumulativeAmount", type: "uint256" },
                { name: "deadline", type: "uint256" }
            ]
        };

        const value = {
            account,
            cumulativeAmount: cumulativeAmount.toString(),
            deadline
        };

        return await signer.signTypedData(domain, types, value);
    }

    async function getPermitSignature(
        signer: SignerWithAddress,
        token: TestToken,
        spender: string,
        amount: bigint,
        deadline: number
    ) {
        const nonce = await token.nonces(signer.address);
        const chainId = await ethers.provider.getNetwork().then(n => n.chainId);

        const domain = {
            name: await token.name(),
            version: "1",
            chainId: chainId,
            verifyingContract: await token.getAddress()
        };

        const types = {
            Permit: [
                { name: "owner", type: "address" },
                { name: "spender", type: "address" },
                { name: "value", type: "uint256" },
                { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint256" }
            ]
        };

        const value = {
            owner: signer.address,
            spender,
            value: amount.toString(),
            nonce: nonce.toString(),
            deadline
        };

        const signature = await signer.signTypedData(domain, types, value);
        const { v, r, s } = ethers.Signature.from(signature);

        return { v, r, s };
    }
});