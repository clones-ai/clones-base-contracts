import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { RewardPoolImplementation, RewardPoolFactory, TestToken } from "../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("RewardPool Security Features", function () {
    let rewardPool: RewardPoolImplementation;
    let factory: RewardPoolFactory;
    let token: TestToken;
    let owner: SignerWithAddress;
    let publisher: SignerWithAddress;
    let guardian: SignerWithAddress;
    let treasury: SignerWithAddress;
    let creator: SignerWithAddress;
    let user1: SignerWithAddress;
    let user2: SignerWithAddress;
    let unauthorizedUser: SignerWithAddress;

    const INITIAL_SUPPLY = ethers.parseEther("1000000");
    const POOL_FUNDING = ethers.parseEther("10000");

    beforeEach(async function () {
        [owner, publisher, guardian, treasury, creator, user1, user2, unauthorizedUser] = await ethers.getSigners();

        // Deploy token
        const TestTokenFactory = await ethers.getContractFactory("TestToken");
        token = await TestTokenFactory.deploy("Test Token", "TEST", 18);

        // Deploy implementation
        const RewardPoolImplementationFactory = await ethers.getContractFactory("RewardPoolImplementation");
        const implementation = await RewardPoolImplementationFactory.deploy();

        // Deploy factory
        const RewardPoolFactoryFactory = await ethers.getContractFactory("RewardPoolFactory");
        factory = await RewardPoolFactoryFactory.deploy(
            await implementation.getAddress(),
            await treasury.getAddress(),
            await owner.getAddress(),
            await guardian.getAddress(),
            await publisher.getAddress()
        );

        // Allow token
        await factory.connect(owner).setTokenAllowed(await token.getAddress(), true);

        // Create pool
        const tx = await factory.connect(creator).createPool(await token.getAddress());
        const receipt = await tx.wait();
        const event = receipt?.logs.find((log: any) => {
            try {
                return factory.interface.parseLog(log)?.name === "PoolCreated";
            } catch {
                return false;
            }
        });
        const poolAddress = factory.interface.parseLog(event!)?.args[1];
        rewardPool = await ethers.getContractAt("RewardPoolImplementation", poolAddress);

        // Fund pool
        await token.mint(creator.address, POOL_FUNDING);
        await token.connect(creator).approve(await rewardPool.getAddress(), POOL_FUNDING);
        await rewardPool.connect(creator).fund(POOL_FUNDING);
    });

    describe("Nonce-Based Signature System", function () {
        it("Should validate nonce for each claim", async function () {
            const amount = ethers.parseEther("100");
            const nonce = await rewardPool.claimNonce(user1.address);

            const domain = {
                name: "FactoryVault",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await rewardPool.getAddress()
            };

            const types = {
                Claim: [
                    { name: "account", type: "address" },
                    { name: "cumulativeAmount", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const value = {
                account: user1.address,
                cumulativeAmount: amount,
                nonce: nonce
            };

            const signature = await publisher.signTypedData(domain, types, value);


            const nonce2 = await
                rewardPool.claimNonce(user1.address);
            await expect(
                rewardPool.connect(user1).payWithSig(user1.address, amount, nonce2, signature)
            ).to.emit(rewardPool, "ClaimedMinimal");

            expect(await rewardPool.claimNonce(user1.address)).to.equal(nonce + 1n);
        });

        it("Should reject claims with incorrect nonce", async function () {
            const amount = ethers.parseEther("100");

            const domain = {
                name: "FactoryVault",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await rewardPool.getAddress()
            };

            const types = {
                Claim: [
                    { name: "account", type: "address" },
                    { name: "cumulativeAmount", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const value = {
                account: user1.address,
                cumulativeAmount: amount,
                nonce: 5n // Wrong nonce
            };

            const signature = await publisher.signTypedData(domain, types, value);

            await expect(
                rewardPool.connect(user1).payWithSig(user1.address, amount, 5n, signature)
            ).to.be.revertedWithCustomError(rewardPool, "SecurityViolation");
        });

        it("Should increment nonce after successful claim", async function () {
            const amount1 = ethers.parseEther("100");
            const amount2 = ethers.parseEther("200");

            const domain = {
                name: "FactoryVault",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await rewardPool.getAddress()
            };

            const types = {
                Claim: [
                    { name: "account", type: "address" },
                    { name: "cumulativeAmount", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            // First claim
            let currentNonce = await rewardPool.claimNonce(user1.address);
            const value1 = {
                account: user1.address,
                cumulativeAmount: amount1,
                nonce: currentNonce
            };
            const sig1 = await publisher.signTypedData(domain, types, value1);
            await rewardPool.connect(user1).payWithSig(user1.address, amount1, currentNonce, sig1);

            // Nonce incremented
            currentNonce = await rewardPool.claimNonce(user1.address);
            expect(currentNonce).to.equal(1n);

            // Second claim with new nonce
            const value2 = {
                account: user1.address,
                cumulativeAmount: amount2,
                nonce: currentNonce
            };
            const sig2 = await publisher.signTypedData(domain, types, value2);
            await rewardPool.connect(user1).payWithSig(user1.address, amount2, currentNonce, sig2);

            expect(await rewardPool.claimNonce(user1.address)).to.equal(2n);
        });

        it("Should maintain separate nonces per account", async function () {
            const amount = ethers.parseEther("50");

            const domain = {
                name: "FactoryVault",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await rewardPool.getAddress()
            };

            const types = {
                Claim: [
                    { name: "account", type: "address" },
                    { name: "cumulativeAmount", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            // User1 claim
            const value1 = {
                account: user1.address,
                cumulativeAmount: amount,
                nonce: 0n
            };
            const sig1 = await publisher.signTypedData(domain, types, value1);
            await rewardPool.connect(user1).payWithSig(user1.address, amount, 0n, sig1);

            expect(await rewardPool.claimNonce(user1.address)).to.equal(1n);
            expect(await rewardPool.claimNonce(user2.address)).to.equal(0n);

            // User2 can still use nonce 0
            const value2 = {
                account: user2.address,
                cumulativeAmount: amount,
                nonce: 0n
            };
            const sig2 = await publisher.signTypedData(domain, types, value2);
            await rewardPool.connect(user2).payWithSig(user2.address, amount, 0n, sig2);

            expect(await rewardPool.claimNonce(user2.address)).to.equal(1n);
        });
    });

    describe("Dynamic Minimum Claim Amount", function () {
        it("Should enforce minimum for 18-decimal tokens", async function () {
            const tooSmall = ethers.parseEther("0.009");
            const valid = ethers.parseEther("0.01");

            const domain = {
                name: "FactoryVault",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await rewardPool.getAddress()
            };

            const types = {
                Claim: [
                    { name: "account", type: "address" },
                    { name: "cumulativeAmount", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            // Too small
            const valueTooSmall = {
                account: user1.address,
                cumulativeAmount: tooSmall,
                nonce: 0n
            };
            const sigTooSmall = await publisher.signTypedData(domain, types, valueTooSmall);

            await expect(
                rewardPool.connect(user1).payWithSig(user1.address, tooSmall, 0n, sigTooSmall)
            ).to.be.revertedWithCustomError(rewardPool, "SecurityViolation");

            // Valid
            const valueValid = {
                account: user1.address,
                cumulativeAmount: valid,
                nonce: 0n
            };
            const sigValid = await publisher.signTypedData(domain, types, valueValid);

            await expect(
                rewardPool.connect(user1).payWithSig(user1.address, valid, 0n, sigValid)
            ).to.emit(rewardPool, "ClaimedMinimal");
        });

        it("Should adapt to 6-decimal tokens", async function () {
            const TestTokenFactory = await ethers.getContractFactory("TestToken");
            const token6 = await TestTokenFactory.deploy("USDC", "USDC", 6);

            await factory.connect(owner).setTokenAllowed(await token6.getAddress(), true);
            const tx = await factory.connect(creator).createPool(await token6.getAddress());
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => {
                try {
                    return factory.interface.parseLog(log)?.name === "PoolCreated";
                } catch {
                    return false;
                }
            });
            const poolAddress = factory.interface.parseLog(event!)?.args[1];
            const pool6 = await ethers.getContractAt("RewardPoolImplementation", poolAddress);

            const funding6 = 10000n * 10n ** 6n;
            await token6.mint(creator.address, funding6);
            await token6.connect(creator).approve(await pool6.getAddress(), funding6);
            await pool6.connect(creator).fund(funding6);

            const tooSmall6 = 9999n;
            const valid6 = 10000n;

            const domain = {
                name: "FactoryVault",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await pool6.getAddress()
            };

            const types = {
                Claim: [
                    { name: "account", type: "address" },
                    { name: "cumulativeAmount", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const valueTooSmall = {
                account: user1.address,
                cumulativeAmount: tooSmall6,
                nonce: 0n
            };
            const sigTooSmall = await publisher.signTypedData(domain, types, valueTooSmall);

            await expect(
                pool6.connect(user1).payWithSig(user1.address, tooSmall6, 0n, sigTooSmall)
            ).to.be.revertedWithCustomError(pool6, "SecurityViolation");

            const valueValid = {
                account: user1.address,
                cumulativeAmount: valid6,
                nonce: 0n
            };
            const sigValid = await publisher.signTypedData(domain, types, valueValid);

            await expect(
                pool6.connect(user1).payWithSig(user1.address, valid6, 0n, sigValid)
            ).to.emit(pool6, "ClaimedMinimal");
        });
    });

    describe("Creator Withdrawal Controls", function () {
        it("Should enforce withdrawal lock period", async function () {
            const amount = ethers.parseEther("1000");

            await expect(
                rewardPool.connect(creator).withdraw(amount)
            ).to.be.revertedWithCustomError(rewardPool, "SecurityViolation");

            await time.increase(6n * 24n * 3600n);
            await expect(
                rewardPool.connect(creator).withdraw(amount)
            ).to.be.revertedWithCustomError(rewardPool, "SecurityViolation");

            await time.increase(24n * 3600n);
            await expect(
                rewardPool.connect(creator).withdraw(amount)
            ).to.emit(rewardPool, "Withdrawn");
        });

        it("Should enforce rate limit on withdrawals", async function () {
            const balance = await token.balanceOf(await rewardPool.getAddress());
            const maxWithdrawal = balance * 2000n / 10000n;

            await time.increase(7n * 24n * 3600n);

            await expect(
                rewardPool.connect(creator).withdraw(maxWithdrawal)
            ).to.emit(rewardPool, "Withdrawn");

            await expect(
                rewardPool.connect(creator).withdraw(1n)
            ).to.be.revertedWithCustomError(rewardPool, "SecurityViolation");

            await time.increase(24n * 3600n);

            const newBalance = await token.balanceOf(await rewardPool.getAddress());
            const newMax = newBalance * 2000n / 10000n;

            await expect(
                rewardPool.connect(creator).withdraw(newMax)
            ).to.emit(rewardPool, "Withdrawn");
        });

        it("Should emit event for large withdrawals", async function () {
            const balance = await token.balanceOf(await rewardPool.getAddress());
            const largeAmount = balance * 15n / 100n;

            await time.increase(7n * 24n * 3600n);

            await expect(
                rewardPool.connect(creator).withdraw(largeAmount)
            ).to.emit(rewardPool, "LargeCreatorWithdrawal");
        });

        it("Should restrict withdrawals to creator only", async function () {
            await time.increase(7n * 24n * 3600n);

            await expect(
                rewardPool.connect(unauthorizedUser).withdraw(ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(rewardPool, "Unauthorized");
        });
    });

    describe("Fee Calculation Safety", function () {
        it("Should handle large amounts", async function () {
            const amount = ethers.parseEther("1000000000");

            await token.mint(await rewardPool.getAddress(), amount);

            const domain = {
                name: "FactoryVault",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await rewardPool.getAddress()
            };

            const types = {
                Claim: [
                    { name: "account", type: "address" },
                    { name: "cumulativeAmount", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const value = {
                account: user1.address,
                cumulativeAmount: amount,
                nonce: 0n
            };

            const signature = await publisher.signTypedData(domain, types, value);

            await rewardPool.connect(user1).payWithSig(user1.address, amount, 0n, signature);

            const expectedFee = amount * 1000n / 10000n;
            const feePaid = await rewardPool.alreadyFeePaid(user1.address);
            expect(feePaid).to.equal(expectedFee);
        });

        it("Should reject amounts exceeding max uint256", async function () {
            const maxAmount = ethers.MaxUint256;

            const domain = {
                name: "FactoryVault",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await rewardPool.getAddress()
            };

            const types = {
                Claim: [
                    { name: "account", type: "address" },
                    { name: "cumulativeAmount", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const value = {
                account: user1.address,
                cumulativeAmount: maxAmount,
                nonce: 0n
            };

            const signature = await publisher.signTypedData(domain, types, value);

            await expect(
                rewardPool.connect(user1).payWithSig(user1.address, maxAmount, 0n, signature)
            ).to.be.revertedWithCustomError(rewardPool, "InvalidParameter");
        });
    });

    describe("Emergency Controls", function () {
        it("Should allow guardian to pause claims", async function () {
            const amount = ethers.parseEther("100");

            const domain = {
                name: "FactoryVault",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await rewardPool.getAddress()
            };

            const types = {
                Claim: [
                    { name: "account", type: "address" },
                    { name: "cumulativeAmount", type: "uint256" },
                    { name: "nonce", type: "uint256" }
                ]
            };

            const value = {
                account: user1.address,
                cumulativeAmount: amount,
                nonce: 0n
            };

            const signature = await publisher.signTypedData(domain, types, value);

            await rewardPool.connect(guardian).pause();

            await expect(
                rewardPool.connect(user1).payWithSig(user1.address, amount, 0n, signature)
            ).to.be.revertedWithCustomError(rewardPool, "EnforcedPause");

            await rewardPool.connect(owner).unpause();

            await expect(
                rewardPool.connect(user1).payWithSig(user1.address, amount, 0n, signature)
            ).to.emit(rewardPool, "ClaimedMinimal");
        });

        it("Should support factory-wide emergency pause", async function () {
            await expect(
                factory.connect(guardian).emergencyPauseAll()
            ).to.emit(factory, "EmergencyPauseAll");

            await expect(
                factory.connect(creator).createPool(await token.getAddress())
            ).to.be.revertedWithCustomError(factory, "EnforcedPause");
        });
    });
});