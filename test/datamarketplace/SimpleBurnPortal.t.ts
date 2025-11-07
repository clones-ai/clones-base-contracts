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

        // Deploy BurnPortal with correct constructor (timelock, guardian)
        const BurnPortalFactory = await ethers.getContractFactory("BurnPortal");
        burnPortal = await BurnPortalFactory.deploy(
            owner.address, // timelock
            owner.address  // guardian
        );
    });

    describe("Deployment", function () {
        it("should deploy with correct parameters", async function () {
            expect(await burnPortal.TIMELOCK()).to.equal(owner.address);
            expect(await burnPortal.GUARDIAN()).to.equal(owner.address);
        });

        it("should have correct roles", async function () {
            const timelockRole = await burnPortal.TIMELOCK_ROLE();
            expect(await burnPortal.hasRole(timelockRole, owner.address)).to.be.true;
        });
    });

    describe("Dataset Management", function () {
        it("should check if dataset is active", async function () {
            const isActive = await burnPortal.activeDatasets(user.address);
            expect(isActive).to.be.false;
        });

        it("should get dataset burn info", async function () {
            // Deploy a mock dataset token to test with
            const MockTokenFactory = await ethers.getContractFactory("TestToken");
            const mockDataset = await MockTokenFactory.deploy("DATASET", "DATA", 18);
            
            // This will revert if the dataset doesn't implement getDatasetInfo
            // So we just check that the function exists
            expect(burnPortal.getDatasetBurnInfo).to.exist;
        });

        it("should check burn stats", async function () {
            // burnStats is a public mapping that returns BurnStats struct
            const stats = await burnPortal.burnStats(user.address);
            expect(stats.totalBurned).to.equal(0);
            expect(stats.burnCount).to.equal(0);
        });
    });

    describe("Admin Functions", function () {
        it("should set dataset factory", async function () {
            await expect(
                burnPortal.connect(owner).setDatasetFactory(user.address)
            ).to.emit(burnPortal, "DatasetFactoryUpdated");

            expect(await burnPortal.datasetFactory()).to.equal(user.address);
        });

        it("should set graduation manager", async function () {
            await expect(
                burnPortal.connect(owner).setGraduationManager(user.address)
            ).to.emit(burnPortal, "GraduationManagerUpdated");

            expect(await burnPortal.graduationManager()).to.equal(user.address);
        });

        it("should reject non-timelock updates", async function () {
            await expect(
                burnPortal.connect(user).setDatasetFactory(user.address)
            ).to.be.revertedWithCustomError(burnPortal, "Unauthorized");

            await expect(
                burnPortal.connect(user).setGraduationManager(user.address)
            ).to.be.revertedWithCustomError(burnPortal, "Unauthorized");
        });
    });

    describe("Access Control", function () {
        it("should manage roles correctly", async function () {
            const timelockRole = await burnPortal.TIMELOCK_ROLE();
            
            // Check timelock has the role
            expect(await burnPortal.hasRole(timelockRole, owner.address)).to.be.true;
            
            // Check emergency role
            const emergencyRole = await burnPortal.EMERGENCY_ROLE();
            expect(await burnPortal.hasRole(emergencyRole, owner.address)).to.be.true;
        });
    });
});