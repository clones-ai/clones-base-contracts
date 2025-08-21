import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { RewardPool } from "../typechain-types";

describe("RewardPool - Access Control Tests", function () {
    let deployer: SignerWithAddress,
        admin: SignerWithAddress,
        treasury: SignerWithAddress,
        factory: SignerWithAddress,
        rando: SignerWithAddress;
    let rewardPool: RewardPool;

    const ZERO_ADDRESS = ethers.ZeroAddress;
    const DEFAULT_ADMIN_ROLE =
        "0x0000000000000000000000000000000000000000000000000000000000000000";
    const TREASURER_ROLE = ethers.id("TREASURER_ROLE");
    const PAUSER_ROLE = ethers.id("PAUSER_ROLE");
    const FACTORY_ROLE = ethers.id("FACTORY_ROLE");

    beforeEach(async function () {
        [deployer, admin, treasury, factory, rando] = await ethers.getSigners();

        const RewardPoolFactory = await ethers.getContractFactory("RewardPool");
        rewardPool = (await upgrades.deployProxy(RewardPoolFactory, [
            admin.address,
            treasury.address,
            1000,
            ZERO_ADDRESS,
        ])) as unknown as RewardPool;
        await rewardPool.waitForDeployment();
    });

    const ACCESS_CONTROL_ERROR = "AccessControlUnauthorizedAccount";

    describe("Admin Role", function () {
        it("admin should have DEFAULT_ADMIN_ROLE", async function () {
            expect(
                await rewardPool.hasRole(DEFAULT_ADMIN_ROLE, admin.address)
            ).to.be.true;
        });

        it("non-admin should not be able to grant roles", async function () {
            await expect(
                rewardPool.connect(rando).grantRole(FACTORY_ROLE, rando.address)
            ).to.be.revertedWithCustomError(rewardPool, ACCESS_CONTROL_ERROR)
                .withArgs(rando.address, DEFAULT_ADMIN_ROLE);
        });

        it("non-admin should not be able to set max fee bps", async function () {
            await expect(
                rewardPool.connect(rando).setMaxFeeBps(3000)
            ).to.be.revertedWithCustomError(rewardPool, ACCESS_CONTROL_ERROR)
                .withArgs(rando.address, DEFAULT_ADMIN_ROLE);
        });
    });

    describe("Treasurer Role", function () {
        beforeEach(async function () {
            await rewardPool.connect(admin).grantRole(TREASURER_ROLE, treasury.address);
        });

        it("treasurer should be able to set fee bps", async function () {
            await expect(rewardPool.connect(treasury).setFeeBps(1500)).to.not.be
                .reverted;
        });

        it("non-treasurer should not be able to set fee bps", async function () {
            await expect(
                rewardPool.connect(rando).setFeeBps(1500)
            ).to.be.revertedWithCustomError(rewardPool, ACCESS_CONTROL_ERROR)
                .withArgs(rando.address, TREASURER_ROLE);
        });

        it("treasurer should be able to sweep fees", async function () {
            // No fees to sweep, but the call should not revert for access control reasons
            await expect(rewardPool.connect(treasury).sweepFees([])).to.not.be
                .reverted;
        });
    });

    describe("Pauser Role", function () {
        beforeEach(async function () {
            await rewardPool.connect(admin).grantRole(PAUSER_ROLE, admin.address);
        });

        it("pauser should be able to pause and unpause", async function () {
            await expect(rewardPool.connect(admin).pause()).to.not.be.reverted;
            expect(await rewardPool.paused()).to.be.true;
            await expect(rewardPool.connect(admin).unpause()).to.not.be.reverted;
            expect(await rewardPool.paused()).to.be.false;
        });

        it("non-pauser should not be able to pause", async function () {
            await expect(rewardPool.connect(rando).pause()).to.be.revertedWithCustomError(rewardPool, ACCESS_CONTROL_ERROR)
                .withArgs(rando.address, PAUSER_ROLE);
        });
    });

    describe("Factory Role", function () {
        beforeEach(async function () {
            await rewardPool.connect(admin).grantRole(FACTORY_ROLE, factory.address);
        });

        it("factory should be able to fund", async function () {
            await expect(
                rewardPool.connect(factory).fundFactoryNative({ value: 100 })
            ).to.not.be.reverted;
        });

        it("non-factory should not be able to fund", async function () {
            await expect(
                rewardPool.connect(rando).fundFactoryNative({ value: 100 })
            ).to.be.revertedWithCustomError(rewardPool, ACCESS_CONTROL_ERROR)
                .withArgs(rando.address, FACTORY_ROLE);
        });
    });
});
