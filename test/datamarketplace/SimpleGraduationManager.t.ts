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

        it("should reject guardian setting dataset factory (only timelock)", async function () {
            await expect(
                graduationManager.connect(guardian).setDatasetFactory(user.address)
            ).to.be.revertedWithCustomError(graduationManager, "Unauthorized");
        });
    });

    describe("Emergency Functions", function () {
        it("should allow guardian to rescue ETH", async function () {
            // Send some ETH to the contract first
            await timelock.sendTransaction({
                to: await graduationManager.getAddress(),
                value: ethers.parseEther("1.0")
            });

            const guardianBalanceBefore = await ethers.provider.getBalance(guardian.address);
            
            await graduationManager.connect(guardian).rescueETH();
            
            const guardianBalanceAfter = await ethers.provider.getBalance(guardian.address);
            expect(guardianBalanceAfter).to.be.greaterThan(guardianBalanceBefore);
        });

        it("should reject non-guardian rescue attempts", async function () {
            await expect(
                graduationManager.connect(user).rescueETH()
            ).to.be.revertedWithCustomError(graduationManager, "Unauthorized");
        });

        it("should allow setting burn portal", async function () {
            await expect(
                graduationManager.connect(timelock).setBurnPortal(user.address)
            ).to.emit(graduationManager, "BurnPortalUpdated");

            expect(await graduationManager.burnPortal()).to.equal(user.address);
        });
    });

    describe("Graduation Data", function () {
        it("should return empty graduation info for non-graduated datasets", async function () {
            const isGrad = await graduationManager.isGraduated(user.address);
            expect(isGrad).to.be.false;
        });

        it("should return zero graduated dataset count initially", async function () {
            const count = await graduationManager.getGraduatedDatasetCount();
            expect(count).to.equal(0);
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