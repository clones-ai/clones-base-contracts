import { ethers } from "hardhat";
import { expect } from "chai";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import {
    RewardPoolFactory,
    RewardPoolImplementation,
    TestToken,
    ClaimRouter
} from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("ClaimRouter", function () {
    let factory: RewardPoolFactory;
    let implementation: RewardPoolImplementation;
    let vault1: RewardPoolImplementation;
    let vault2: RewardPoolImplementation;
    let testToken: TestToken;
    let testToken2: TestToken;
    let claimRouter: ClaimRouter;

    let timelock: SignerWithAddress;
    let guardian: SignerWithAddress;
    let publisher: SignerWithAddress;
    let creator: SignerWithAddress;
    let creator2: SignerWithAddress;
    let treasury: SignerWithAddress;
    let funder: SignerWithAddress;
    let claimer: SignerWithAddress;
    let relayer: SignerWithAddress;

    const DOMAIN_NAME = "FactoryVault";
    const DOMAIN_VERSION = "1";
    const FUND_AMOUNT = ethers.parseUnits("1000", 18);
    const CLAIM_AMOUNT = ethers.parseUnits("100", 18);

    beforeEach(async function () {
        [timelock, guardian, publisher, creator, creator2, treasury, funder, claimer, relayer] = await ethers.getSigners();

        // Deploy test tokens
        const TestTokenFactory = await ethers.getContractFactory("TestToken");
        testToken = await TestTokenFactory.deploy("Test Token", "TEST", 18);
        testToken2 = await TestTokenFactory.deploy("Test Token 2", "TEST2", 18);

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

        // Setup: Approve factory in router and tokens in factory
        await claimRouter.connect(timelock).setFactoryApproved(await factory.getAddress(), true);
        await factory.connect(timelock).setTokenAllowed(await testToken.getAddress(), true);
        await factory.connect(timelock).setTokenAllowed(await testToken2.getAddress(), true);

        // Create vaults
        const [vault1Address] = await factory.predictPoolAddress(creator.address, await testToken.getAddress());
        const [vault2Address] = await factory.predictPoolAddress(creator2.address, await testToken2.getAddress());

        await factory.connect(creator).createPool(await testToken.getAddress());
        await factory.connect(creator2).createPool(await testToken2.getAddress());

        vault1 = await ethers.getContractAt("RewardPoolImplementation", vault1Address);
        vault2 = await ethers.getContractAt("RewardPoolImplementation", vault2Address);

        // Fund vaults
        await testToken.mint(funder.address, FUND_AMOUNT * 2n);
        await testToken2.mint(funder.address, FUND_AMOUNT * 2n);

        await testToken.connect(funder).approve(await await vault1.getAddress(), FUND_AMOUNT);
        await testToken2.connect(funder).approve(await await vault2.getAddress(), FUND_AMOUNT);

        await vault1.connect(funder).fund(FUND_AMOUNT);
        await vault2.connect(funder).fund(FUND_AMOUNT);
    });

    describe("Deployment", function () {
        it("Should set correct initial state", async function () {
            expect(await claimRouter.TIMELOCK()).to.equal(timelock.address);
            expect(await claimRouter.maxBatchSize()).to.equal(20);
        });

        it("Should reject zero address timelock", async function () {
            const RouterFactory = await ethers.getContractFactory("ClaimRouter");
            await expect(RouterFactory.deploy(ethers.ZeroAddress))
                .to.be.revertedWithCustomError(claimRouter, "InvalidParameter")
                .withArgs("timelock");
        });
    });

    describe("Governance", function () {
        it("Should allow timelock to approve factories", async function () {
            const newFactory = creator.address; // Use any address for test

            await expect(claimRouter.connect(timelock).setFactoryApproved(newFactory, true))
                .to.emit(claimRouter, "FactoryApprovalUpdated")
                .withArgs(newFactory, true);

            expect(await claimRouter.approvedFactories(newFactory)).to.be.true;
        });

        it("Should allow timelock to update batch size", async function () {
            await expect(claimRouter.connect(timelock).setMaxBatchSize(50))
                .to.emit(claimRouter, "MaxBatchSizeUpdated")
                .withArgs(20, 50);

            expect(await claimRouter.maxBatchSize()).to.equal(50);
        });

        it("Should reject non-timelock governance operations", async function () {
            await expect(claimRouter.connect(creator).setFactoryApproved(creator.address, true))
                .to.be.revertedWithCustomError(claimRouter, "Unauthorized")
                .withArgs("timelock");

            await expect(claimRouter.connect(creator).setMaxBatchSize(50))
                .to.be.revertedWithCustomError(claimRouter, "Unauthorized")
                .withArgs("timelock");
        });

        it("Should reject invalid batch sizes", async function () {
            await expect(claimRouter.connect(timelock).setMaxBatchSize(0))
                .to.be.revertedWithCustomError(claimRouter, "InvalidParameter")
                .withArgs("batch_size");

            await expect(claimRouter.connect(timelock).setMaxBatchSize(101))
                .to.be.revertedWithCustomError(claimRouter, "InvalidParameter")
                .withArgs("batch_size");
        });

        it("Should reject zero address factory", async function () {
            await expect(claimRouter.connect(timelock).setFactoryApproved(ethers.ZeroAddress, true))
                .to.be.revertedWithCustomError(claimRouter, "InvalidParameter")
                .withArgs("factory");
        });
    });

    describe("Batch Claims", function () {
        it("Should process single claim successfully", async function () {
            const signature = await signClaim(publisher, await vault1.getAddress(), claimer.address, CLAIM_AMOUNT);

            const claimData = [{
                vault: await await vault1.getAddress(),
                account: claimer.address,
                cumulativeAmount: CLAIM_AMOUNT,
                signature
            }];

            await expect(claimRouter.connect(relayer).claimAll(claimData))
                .to.emit(claimRouter, "ClaimSucceeded")
                .to.emit(claimRouter, "BatchClaimed")
                .withArgs(relayer.address, 1, 0, CLAIM_AMOUNT, anyValue, anyValue, anyValue);

            expect(await testToken.balanceOf(claimer.address)).to.be.greaterThan(0);
        });

        it("Should process multiple claims in batch", async function () {
            const signature1 = await signClaim(publisher, await vault1.getAddress(), claimer.address, CLAIM_AMOUNT);
            const signature2 = await signClaim(publisher, await vault2.getAddress(), claimer.address, CLAIM_AMOUNT);

            const claimData = [
                {
                    vault: await await vault1.getAddress(),
                    account: claimer.address,
                    cumulativeAmount: CLAIM_AMOUNT,
                    signature: signature1
                },
                {
                    vault: await await vault2.getAddress(),
                    account: claimer.address,
                    cumulativeAmount: CLAIM_AMOUNT,
                    signature: signature2
                }
            ];

            await expect(claimRouter.connect(relayer).claimAll(claimData))
                .to.emit(claimRouter, "BatchClaimed")
                .withArgs(relayer.address, 2, 0, CLAIM_AMOUNT * 2n, anyValue, anyValue, anyValue);

            expect(await testToken.balanceOf(claimer.address)).to.be.greaterThan(0);
            expect(await testToken2.balanceOf(claimer.address)).to.be.greaterThan(0);
        });

        it("Should handle mixed success/failure gracefully", async function () {
            const validSignature = await signClaim(publisher, await vault1.getAddress(), claimer.address, CLAIM_AMOUNT);
            const invalidSignature = "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

            const claimData = [
                {
                    vault: await await vault1.getAddress(),
                    account: claimer.address,
                    cumulativeAmount: CLAIM_AMOUNT,
                    signature: validSignature
                },
                {
                    vault: await await vault2.getAddress(),
                    account: claimer.address,
                    cumulativeAmount: CLAIM_AMOUNT,
                    signature: invalidSignature
                }
            ];

            await expect(claimRouter.connect(relayer).claimAll(claimData))
                .to.emit(claimRouter, "ClaimSucceeded")
                .to.emit(claimRouter, "ClaimFailed")
                .to.emit(claimRouter, "BatchClaimed")
                .withArgs(relayer.address, 1, 1, CLAIM_AMOUNT, anyValue, anyValue, anyValue);
        });

        it("Should reject claims from non-approved factories", async function () {
            // Create a different factory
            const NewFactoryFactory = await ethers.getContractFactory("RewardPoolFactory");
            const newFactory = await NewFactoryFactory.deploy(
                await implementation.getAddress(),
                treasury.address,
                timelock.address,
                guardian.address,
                publisher.address
            );

            // Don't approve this factory in router
            await newFactory.connect(timelock).setTokenAllowed(await testToken.getAddress(), true);
            const [rogueVaultAddress] = await newFactory.predictPoolAddress(creator.address, await testToken.getAddress());
            await newFactory.connect(creator).createPool(await testToken.getAddress());
            const rogueVault = await ethers.getContractAt("RewardPoolImplementation", rogueVaultAddress);

            const signature = await signClaim(publisher, await rogueVault.getAddress(), claimer.address, CLAIM_AMOUNT);

            const claimData = [{
                vault: await rogueVault.getAddress(),
                account: claimer.address,
                cumulativeAmount: CLAIM_AMOUNT,
                signature
            }];

            await expect(claimRouter.connect(relayer).claimAll(claimData))
                .to.emit(claimRouter, "ClaimFailed")
                .withArgs(await rogueVault.getAddress(), claimer.address, "Factory not approved")
                .to.emit(claimRouter, "BatchClaimed")
                .withArgs(relayer.address, 0, 1, 0, 0, 0, anyValue);
        });

        it("Should handle paused vaults gracefully", async function () {
            // Pause vault1
            await vault1.connect(guardian).pause();

            const signature1 = await signClaim(publisher, await vault1.getAddress(), claimer.address, CLAIM_AMOUNT);
            const signature2 = await signClaim(publisher, await vault2.getAddress(), claimer.address, CLAIM_AMOUNT);

            const claimData = [
                {
                    vault: await await vault1.getAddress(),
                    account: claimer.address,
                    cumulativeAmount: CLAIM_AMOUNT,
                    signature: signature1
                },
                {
                    vault: await await vault2.getAddress(),
                    account: claimer.address,
                    cumulativeAmount: CLAIM_AMOUNT,
                    signature: signature2
                }
            ];

            await expect(claimRouter.connect(relayer).claimAll(claimData))
                .to.emit(claimRouter, "ClaimFailed")
                .withArgs(await vault1.getAddress(), claimer.address, "Low-level failure")
                .to.emit(claimRouter, "ClaimSucceeded")
                .to.emit(claimRouter, "BatchClaimed")
                .withArgs(relayer.address, 1, 1, CLAIM_AMOUNT, anyValue, anyValue, anyValue);
        });

        it("Should reject empty batches", async function () {
            await expect(claimRouter.connect(relayer).claimAll([]))
                .to.be.revertedWithCustomError(claimRouter, "InvalidParameter")
                .withArgs("batch_size");
        });

        it("Should reject oversized batches", async function () {
            // Create batch larger than maxBatchSize (20)
            const largeBatch = Array(21).fill({
                vault: await await vault1.getAddress(),
                account: claimer.address,
                cumulativeAmount: CLAIM_AMOUNT,
                signature: "0x00"
            });

            await expect(claimRouter.connect(relayer).claimAll(largeBatch))
                .to.be.revertedWithCustomError(claimRouter, "InvalidParameter")
                .withArgs("batch_size");
        });

        it("Should handle invalid vault addresses", async function () {
            const signature = await signClaim(publisher, await vault1.getAddress(), claimer.address, CLAIM_AMOUNT);

            const invalidVault = "0x1234567890123456789012345678901234567890"; // Invalid vault but not zero
            const claimData = [{
                vault: invalidVault,
                account: claimer.address,
                cumulativeAmount: CLAIM_AMOUNT,
                signature
            }];

            // Invalid vault causes complete transaction revert
            await expect(claimRouter.connect(relayer).claimAll(claimData))
                .to.be.reverted;
        });
    });

    describe("Gas Benchmarks", function () {
        it("Should benchmark batch claim gas usage", async function () {
            // Create batch of 5 claims
            const batchSize = 5;
            const claimData = [];

            for (let i = 0; i < batchSize; i++) {
                const signature = await signClaim(
                    publisher,
                    i % 2 === 0 ? await await vault1.getAddress() : await await vault2.getAddress(),
                    claimer.address,
                    CLAIM_AMOUNT
                );

                claimData.push({
                    vault: i % 2 === 0 ? await await vault1.getAddress() : await await vault2.getAddress(),
                    account: claimer.address,
                    cumulativeAmount: CLAIM_AMOUNT,
                    signature
                });
            }

            const tx = await claimRouter.connect(relayer).claimAll(claimData);
            const receipt = await tx.wait();

            // Target: < 110k gas per claim average
            const gasPerClaim = Number(receipt!.gasUsed) / batchSize;
            console.log(`Batch claim gas per item: ${gasPerClaim.toFixed(0)}`);
            expect(gasPerClaim).to.be.lessThan(110000);
        });
    });

    // Helper function for signing claims
    async function signClaim(
        signer: SignerWithAddress,
        vaultAddress: string,
        account: string,
        cumulativeAmount: bigint
    ): Promise<string> {
        const chainId = await ethers.provider.getNetwork().then(n => n.chainId);

        const domain = {
            name: DOMAIN_NAME,
            version: DOMAIN_VERSION,
            chainId: chainId,
            verifyingContract: vaultAddress
        };

        const types = {
            Claim: [
                { name: "account", type: "address" },
                { name: "cumulativeAmount", type: "uint256" }
            ]
        };

        const value = {
            account,
            cumulativeAmount: cumulativeAmount.toString()
        };

        return await signer.signTypedData(domain, types, value);
    }
});

