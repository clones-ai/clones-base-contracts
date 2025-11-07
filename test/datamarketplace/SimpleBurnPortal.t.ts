import { ethers } from "hardhat";
import { expect } from "chai";
import { BurnPortal, DatasetFactory } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("BurnPortal Basic Tests", function () {
    let burnPortal: BurnPortal;
    let owner: SignerWithAddress;
    let user: SignerWithAddress;

    beforeEach(async function () {
        [owner, user] = await ethers.getSigners();

        // Deploy a simple factory mock
        const MockTokenFactory = await ethers.getContractFactory("TestToken");
        const mockFactory = await MockTokenFactory.deploy("FACTORY", "FACT", 18);

        // Deploy BurnPortal
        const BurnPortalFactory = await ethers.getContractFactory("BurnPortal");
        burnPortal = await BurnPortalFactory.deploy(
            await mockFactory.getAddress(),
            owner.address // graduation manager
        );
    });

    describe("Deployment", function () {
        it("should deploy with correct parameters", async function () {
            expect(await burnPortal.graduationManager()).to.equal(owner.address);
        });

        it("should have correct roles", async function () {
            const adminRole = await burnPortal.DEFAULT_ADMIN_ROLE();
            expect(await burnPortal.hasRole(adminRole, owner.address)).to.be.true;
        });
    });

    describe("Dataset Management", function () {
        it("should check if dataset is active", async function () {
            const isActive = await burnPortal.isDatasetActive(user.address);
            expect(isActive).to.be.false;
        });

        it("should get dataset stats", async function () {
            const stats = await burnPortal.getDatasetStats(user.address);
            expect(stats.totalBurned).to.equal(0);
            expect(stats.burnCount).to.equal(0);
        });

        it("should get user dataset stats", async function () {
            const stats = await burnPortal.getUserDatasetStats(user.address, owner.address);
            expect(stats.totalBurned).to.equal(0);
            expect(stats.burnCount).to.equal(0);
        });

        it("should check user access", async function () {
            const hasAccess = await burnPortal.hasUserBurnedForAccess(user.address, owner.address);
            expect(hasAccess).to.be.false;
        });
    });

    describe("Admin Functions", function () {
        it("should update dataset factory", async function () {
            await expect(
                burnPortal.connect(owner).updateDatasetFactory(user.address)
            ).to.emit(burnPortal, "DatasetFactoryUpdated");

            expect(await burnPortal.datasetFactory()).to.equal(user.address);
        });

        it("should update graduation manager", async function () {
            await expect(
                burnPortal.connect(owner).updateGraduationManager(user.address)
            ).to.emit(burnPortal, "GraduationManagerUpdated");

            expect(await burnPortal.graduationManager()).to.equal(user.address);
        });

        it("should reject non-admin updates", async function () {
            await expect(
                burnPortal.connect(user).updateDatasetFactory(user.address)
            ).to.be.revertedWithCustomError(burnPortal, "AccessControlUnauthorizedAccount");

            await expect(
                burnPortal.connect(user).updateGraduationManager(user.address)
            ).to.be.revertedWithCustomError(burnPortal, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Access Control", function () {
        it("should manage roles correctly", async function () {
            const adminRole = await burnPortal.DEFAULT_ADMIN_ROLE();
            
            // Grant role
            await burnPortal.connect(owner).grantRole(adminRole, user.address);
            expect(await burnPortal.hasRole(adminRole, user.address)).to.be.true;

            // Revoke role
            await burnPortal.connect(owner).revokeRole(adminRole, user.address);
            expect(await burnPortal.hasRole(adminRole, user.address)).to.be.false;
        });
    });
});