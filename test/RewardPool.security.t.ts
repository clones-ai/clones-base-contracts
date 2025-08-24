import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
    RewardPool,
    MaliciousERC20,
    TestToken,
} from "../typechain-types";

describe("RewardPool - Security Tests", function () {
    let deployer: SignerWithAddress,
        admin: SignerWithAddress,
        treasury: SignerWithAddress,
        factory: SignerWithAddress,
        farmer: SignerWithAddress;
    let rewardPool: RewardPool;

    const ZERO_ADDRESS = ethers.ZeroAddress;
    const TREASURER_ROLE = ethers.id("TREASURER_ROLE");
    const FACTORY_ROLE = ethers.id("FACTORY_ROLE");

    beforeEach(async function () {
        [deployer, admin, treasury, factory, farmer] = await ethers.getSigners();

        const RewardPoolFactory = await ethers.getContractFactory("RewardPool");
        rewardPool = (await upgrades.deployProxy(RewardPoolFactory, [
            admin.address,
            treasury.address,
            1000, // 10% fee
            ZERO_ADDRESS, // No sequencer feed for this test
        ])) as unknown as RewardPool;
        await rewardPool.waitForDeployment();

        await rewardPool.connect(admin).grantRole(TREASURER_ROLE, treasury.address);
        await rewardPool.connect(admin).grantRole(FACTORY_ROLE, factory.address);
    });

    describe("Gas Griefing", function () {
        it("should revert if sweepFees is called with too many tokens", async function () {
            const cfg = await rewardPool.config();
            const tokenCount = Number(cfg.maxSweepTokens) + 1;

            const tokenAddresses = Array.from(
                { length: tokenCount },
                (_, i) => `0x${(i + 1).toString().padStart(40, "0")}`
            );

            await expect(
                rewardPool.connect(treasury).sweepFees(tokenAddresses)
            ).to.be.revertedWithCustomError(
                rewardPool,
                "TooManyTokensInSweep"
            );
        });
    });

    describe("Reentrancy", function () {
        let maliciousToken: MaliciousERC20;
        const rewardAmount = ethers.parseUnits("100", 18);

        beforeEach(async function () {
            const MaliciousTokenFactory = await ethers.getContractFactory(
                "MaliciousERC20"
            );
            maliciousToken = await MaliciousTokenFactory.deploy(
                "Malicious Token",
                "MLC"
            );
            await maliciousToken.waitForDeployment();
            await maliciousToken.mint(factory.address, rewardAmount);

            // Fund the factory with the malicious token
            await maliciousToken
                .connect(factory)
                .approve(await rewardPool.getAddress(), rewardAmount);
            await rewardPool
                .connect(factory)
                .fundFactory(await maliciousToken.getAddress(), rewardAmount);

            // Record a reward for the farmer
            const taskId = ethers.id("task-reentrancy");
            await rewardPool
                .connect(factory)
                .recordReward(
                    farmer.address,
                    await maliciousToken.getAddress(),
                    rewardAmount,
                    taskId
                );
        });

        it("should prevent reentrancy during a single withdrawal", async function () {
            // Prepare the attack: the reentrant call will try to withdraw the same reward again
            const attackPayload = rewardPool.interface.encodeFunctionData(
                "withdrawRewards",
                [
                    await maliciousToken.getAddress(),
                    [factory.address],
                    0, // Nonce for the re-entrant call, which will fail
                ]
            );

            await maliciousToken.setAttack(
                await rewardPool.getAddress(),
                farmer.address,
                attackPayload
            );

            // The farmer's first withdrawal attempt. It should fail because the malicious
            // token's re-entrant call fails, causing the whole transaction to revert.
            await expect(
                rewardPool
                    .connect(farmer)
                    .withdrawRewards(
                        await maliciousToken.getAddress(),
                        [factory.address],
                        0
                    )
            ).to.be.reverted;

            // Crucially, check that the farmer's nonce was NOT incremented,
            // meaning the original transaction was fully rolled back.
            expect(await rewardPool.getCurrentNonce(farmer.address)).to.equal(0);
        });

        it("should prevent reentrancy during a batch withdrawal", async function () {
            // Setup a second, legitimate token for the batch
            const TestTokenFactory = await ethers.getContractFactory("TestToken");
            const legitimateToken = await TestTokenFactory.deploy("Legit", "LGT", 18);
            await legitimateToken.waitForDeployment();
            await legitimateToken.mint(factory.address, rewardAmount);

            await legitimateToken
                .connect(factory)
                .approve(await rewardPool.getAddress(), rewardAmount);
            await rewardPool
                .connect(factory)
                .fundFactory(await legitimateToken.getAddress(), rewardAmount);

            const taskId2 = ethers.id("task-legit");
            await rewardPool
                .connect(factory)
                .recordReward(
                    farmer.address,
                    await legitimateToken.getAddress(),
                    rewardAmount,
                    taskId2
                );

            // Prepare the attack: reentrant call will be another batch withdrawal
            const batch = [
                {
                    token: await maliciousToken.getAddress(),
                    factories: [factory.address],
                },
                {
                    token: await legitimateToken.getAddress(),
                    factories: [factory.address],
                },
            ];
            const attackPayload = rewardPool.interface.encodeFunctionData(
                "withdrawBatch",
                [batch, 0] // Nonce for the re-entrant call
            );

            await maliciousToken.setAttack(
                await rewardPool.getAddress(),
                farmer.address,
                attackPayload
            );

            await expect(
                rewardPool.connect(farmer).withdrawBatch(batch, 0)
            ).to.be.reverted;

            expect(await rewardPool.getCurrentNonce(farmer.address)).to.equal(0);
        });
    });
});
