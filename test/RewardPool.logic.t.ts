import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
    RewardPool,
    FeeOnTransferToken,
    MockSequencerUptimeFeed,
} from "../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("RewardPool - Logic and Edge Case Tests", function () {
    let deployer: SignerWithAddress,
        admin: SignerWithAddress,
        treasury: SignerWithAddress,
        factory: SignerWithAddress,
        farmer: SignerWithAddress;
    let rewardPool: RewardPool;
    let mockSequencerFeed: MockSequencerUptimeFeed;

    const ZERO_ADDRESS = ethers.ZeroAddress;
    const FACTORY_ROLE = ethers.id("FACTORY_ROLE");

    beforeEach(async function () {
        [deployer, admin, treasury, factory, farmer] = await ethers.getSigners();

        const MockFeedFactory = await ethers.getContractFactory(
            "MockSequencerUptimeFeed"
        );
        mockSequencerFeed = await MockFeedFactory.deploy();
        await mockSequencerFeed.waitForDeployment();

        const RewardPoolFactory = await ethers.getContractFactory("RewardPool");
        rewardPool = (await upgrades.deployProxy(RewardPoolFactory, [
            admin.address,
            treasury.address,
            1000, // 10% fee
            await mockSequencerFeed.getAddress(),
        ])) as unknown as RewardPool;
        await rewardPool.waitForDeployment();

        await rewardPool.connect(admin).grantRole(FACTORY_ROLE, factory.address);
    });

    describe("Fee Rounding (MEV Protection)", function () {
        it("should round fees up in favor of the treasury", async function () {
            const rewardAmount = 999; // Not perfectly divisible by 10
            const feeBps = 1000; // 10%

            await rewardPool.connect(factory).fundFactoryNative({ value: rewardAmount });
            const taskId = ethers.id("task-rounding");
            await rewardPool
                .connect(factory)
                .recordReward(farmer.address, ZERO_ADDRESS, rewardAmount, taskId);

            const expectedFee = BigInt(
                Math.ceil((rewardAmount * feeBps) / 10000)
            );
            const expectedNet = BigInt(rewardAmount) - expectedFee;

            const farmerBalanceBefore = await ethers.provider.getBalance(
                farmer.address
            );

            const tx = await rewardPool
                .connect(farmer)
                .withdrawRewards(ZERO_ADDRESS, [factory.address], 0);
            const receipt = await tx.wait();
            const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

            const farmerBalanceAfter = await ethers.provider.getBalance(
                farmer.address
            );

            expect(farmerBalanceAfter - farmerBalanceBefore + gasUsed).to.equal(
                expectedNet
            );

            const pendingFees = await rewardPool.pendingFees(ZERO_ADDRESS);
            expect(pendingFees).to.equal(expectedFee);
        });
    });

    describe("Fee-On-Transfer Token Handling", function () {
        let feeToken: FeeOnTransferToken;
        const initialAmount = ethers.parseUnits("1000", 18);

        beforeEach(async function () {
            const FeeTokenFactory = await ethers.getContractFactory(
                "FeeOnTransferToken"
            );
            feeToken = await FeeTokenFactory.deploy("Fee Token", "FEE");
            await feeToken.waitForDeployment();
            await feeToken.mint(factory.address, initialAmount);

            await feeToken
                .connect(factory)
                .approve(rewardPool.getAddress(), initialAmount);
        });

        it("should revert if token fee is too high", async function () {
            // The mock token has a 1% fee (100 bps), which is higher than the
            // contract's 0.1% tolerance (10 bps). This should be rejected.
            await expect(
                rewardPool
                    .connect(factory)
                    .fundFactory(await feeToken.getAddress(), initialAmount)
            ).to.be.revertedWithCustomError(rewardPool, "UnsupportedToken");
        });
    });

    describe("L2 Sequencer Uptime Check", function () {
        it("should revert when the sequencer is down", async function () {
            await mockSequencerFeed.setAnswer(1); // 1 = down

            await expect(
                rewardPool.connect(factory).fundFactoryNative({ value: 100 })
            ).to.be.revertedWithCustomError(rewardPool, "SequencerDown");
        });

        it("should succeed when the sequencer is up", async function () {
            await mockSequencerFeed.setAnswer(0); // 0 = up

            await expect(
                rewardPool.connect(factory).fundFactoryNative({ value: 100 })
            ).to.not.be.reverted;
        });

        it("should skip the check if the feed address is zero", async function () {
            const RewardPoolFactory = await ethers.getContractFactory("RewardPool");
            const poolWithoutFeed = (await upgrades.deployProxy(
                RewardPoolFactory,
                [
                    admin.address,
                    treasury.address,
                    1000,
                    ZERO_ADDRESS, // No feed
                ]
            )) as unknown as RewardPool;
            await poolWithoutFeed.waitForDeployment();
            await poolWithoutFeed
                .connect(admin)
                .grantRole(FACTORY_ROLE, factory.address);

            await mockSequencerFeed.setAnswer(1); // Sequencer is down

            // Still succeeds because the check is skipped
            await expect(
                poolWithoutFeed.connect(factory).fundFactoryNative({ value: 100 })
            ).to.not.be.reverted;
        });
    });
});
