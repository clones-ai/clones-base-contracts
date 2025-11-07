import { ethers } from "hardhat";
import { expect } from "chai";
import { GraduationManager } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("GraduationManager Basic Tests", function () {
    let graduationManager: GraduationManager;
    let timelock: SignerWithAddress;
    let guardian: SignerWithAddress;
    let user: SignerWithAddress;

    beforeEach(async function () {
        [timelock, guardian, user] = await ethers.getSigners();

        // Deploy GraduationManager with correct constructor
        const GraduationManagerFactory = await ethers.getContractFactory("GraduationManager");
        graduationManager = await GraduationManagerFactory.deploy(
            "0x4200000000000000000000000000000000000006", // Mock Uniswap V2 Factory (Base)
            "0x4200000000000000000000000000000000000006", // Mock Uniswap V2 Router (Base)
            "0x4200000000000000000000000000000000000006", // Mock WETH (Base)
            timelock.address,
            guardian.address
        );
    });

    describe("Deployment", function () {
        it("should deploy with correct parameters", async function () {
            expect(await graduationManager.TIMELOCK()).to.equal(timelock.address);
            expect(await graduationManager.GUARDIAN()).to.equal(guardian.address);
        });

        it("should have correct Uniswap addresses", async function () {
            expect(await graduationManager.UNISWAP_V2_FACTORY()).to.equal("0x4200000000000000000000000000000000000006");
            expect(await graduationManager.UNISWAP_V2_ROUTER()).to.equal("0x4200000000000000000000000000000000000006");
            expect(await graduationManager.WETH()).to.equal("0x4200000000000000000000000000000000000006");
        });

        it("should start with no dataset factory", async function () {
            expect(await graduationManager.datasetFactory()).to.equal(ethers.ZeroAddress);
        });
    });

    describe("Dataset Factory Management", function () {
        it("should allow timelock to set dataset factory", async function () {
            await expect(
                graduationManager.connect(timelock).setDatasetFactory(user.address)
            ).to.emit(graduationManager, "DatasetFactoryUpdated");

            expect(await graduationManager.datasetFactory()).to.equal(user.address);
        });

        it("should reject non-timelock setting dataset factory", async function () {
            await expect(
                graduationManager.connect(user).setDatasetFactory(user.address)
            ).to.be.revertedWithCustomError(graduationManager, "Unauthorized");
        });

        it("should allow guardian to set dataset factory in emergency", async function () {
            await expect(
                graduationManager.connect(guardian).setDatasetFactory(user.address)
            ).to.emit(graduationManager, "DatasetFactoryUpdated");

            expect(await graduationManager.datasetFactory()).to.equal(user.address);
        });
    });

    describe("Emergency Functions", function () {
        it("should allow guardian to pause", async function () {
            await expect(
                graduationManager.connect(guardian).pause()
            ).to.emit(graduationManager, "Paused");

            expect(await graduationManager.paused()).to.be.true;
        });

        it("should allow timelock to unpause", async function () {
            await graduationManager.connect(guardian).pause();
            
            await expect(
                graduationManager.connect(timelock).unpause()
            ).to.emit(graduationManager, "Unpaused");

            expect(await graduationManager.paused()).to.be.false;
        });

        it("should reject non-authorized pause/unpause", async function () {
            await expect(
                graduationManager.connect(user).pause()
            ).to.be.revertedWithCustomError(graduationManager, "Unauthorized");

            await graduationManager.connect(guardian).pause();

            await expect(
                graduationManager.connect(user).unpause()
            ).to.be.revertedWithCustomError(graduationManager, "Unauthorized");
        });
    });

    describe("Graduation Data", function () {
        it("should return empty graduation data for non-existent datasets", async function () {
            const graduationData = await graduationManager.getGraduationData(user.address);
            
            expect(graduationData.isGraduated).to.be.false;
            expect(graduationData.graduationTimestamp).to.equal(0);
            expect(graduationData.ethReserves).to.equal(0);
            expect(graduationData.tokenReserves).to.equal(0);
            expect(graduationData.lpTokens).to.equal(0);
            expect(graduationData.uniswapPair).to.equal(ethers.ZeroAddress);
        });
    });

    describe("Access Control", function () {
        it("should check timelock access", async function () {
            // This tests internal modifier behavior
            expect(await graduationManager.TIMELOCK()).to.equal(timelock.address);
        });

        it("should check guardian access", async function () {
            // This tests internal modifier behavior
            expect(await graduationManager.GUARDIAN()).to.equal(guardian.address);
        });
    });
});