import { ethers } from "hardhat";
import { expect } from "chai";
import { DatasetFactory } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("DatasetFactory Basic Tests", function () {
    let datasetFactory: DatasetFactory;
    let owner: SignerWithAddress;
    let creator: SignerWithAddress;

    beforeEach(async function () {
        [owner, creator] = await ethers.getSigners();

        // Deploy a mock CLONES token for testing
        const MockTokenFactory = await ethers.getContractFactory("TestToken");
        const mockClonesToken = await MockTokenFactory.deploy("CLONES", "CLONES", 18);

        // Deploy implementations
        const DatasetTokenImplFactory = await ethers.getContractFactory("DatasetTokenImplementation");
        const tokenImpl = await DatasetTokenImplFactory.deploy();

        const BondingCurveImplFactory = await ethers.getContractFactory("BondingCurveImplementation");
        const curveImpl = await BondingCurveImplFactory.deploy();

        // Deploy DatasetFactory
        const DatasetFactoryFactory = await ethers.getContractFactory("DatasetFactory");
        datasetFactory = await DatasetFactoryFactory.deploy(
            await tokenImpl.getAddress(),
            await curveImpl.getAddress(),
            await mockClonesToken.getAddress(),
            owner.address, // protocol fee recipient
            owner.address, // timelock
            owner.address, // guardian  
            ethers.parseEther("100"), // launch fee
            ethers.parseEther("0.01"), // min liquidity
            ethers.parseEther("100") // max liquidity
        );

        // Give creator some CLONES tokens
        await mockClonesToken.transfer(creator.address, ethers.parseEther("1000"));
        await mockClonesToken.connect(creator).approve(await datasetFactory.getAddress(), ethers.parseEther("1000"));
    });

    describe("Deployment", function () {
        it("should deploy with correct parameters", async function () {
            expect(await datasetFactory.PROTOCOL_FEE_RECIPIENT()).to.equal(owner.address);
            expect(await datasetFactory.TIMELOCK()).to.equal(owner.address);
            expect(await datasetFactory.GUARDIAN()).to.equal(owner.address);
        });

        it("should have correct launch fee", async function () {
            expect(await datasetFactory.LAUNCH_FEE()).to.equal(ethers.parseEther("100"));
        });

        it("should have correct liquidity limits", async function () {
            expect(await datasetFactory.MIN_INITIAL_LIQUIDITY()).to.equal(ethers.parseEther("0.01"));
            expect(await datasetFactory.MAX_INITIAL_LIQUIDITY()).to.equal(ethers.parseEther("100"));
        });
    });

    describe("Dataset Creation", function () {
        it("should predict dataset addresses", async function () {
            const [tokenAddr, curveAddr] = await datasetFactory.predictDatasetAddressWithNonce(
                creator.address,
                "Test Dataset",
                "TDS",
                0
            );

            expect(tokenAddr).to.not.equal(ethers.ZeroAddress);
            expect(curveAddr).to.not.equal(ethers.ZeroAddress);
            expect(tokenAddr).to.not.equal(curveAddr);
        });

        it("should get current launch fee", async function () {
            const currentFee = await datasetFactory.getCurrentLaunchFee();
            expect(currentFee).to.be.greaterThan(0);
        });

        it("should get total datasets count", async function () {
            const count = await datasetFactory.getTotalDatasets();
            expect(count).to.equal(0);
        });
    });

    describe("Access Control", function () {
        it("should have correct roles", async function () {
            const adminRole = await datasetFactory.DEFAULT_ADMIN_ROLE();
            expect(await datasetFactory.hasRole(adminRole, owner.address)).to.be.true;
        });

        it("should allow role queries", async function () {
            const timelockRole = await datasetFactory.TIMELOCK_ROLE();
            const guardianRole = await datasetFactory.GUARDIAN_ROLE();
            
            expect(await datasetFactory.hasRole(timelockRole, owner.address)).to.be.true;
            expect(await datasetFactory.hasRole(guardianRole, owner.address)).to.be.true;
        });
    });

    describe("Oracle Management", function () {
        it("should start with no oracle", async function () {
            expect(await datasetFactory.oracle()).to.equal(ethers.ZeroAddress);
        });

        it("should allow setting oracle", async function () {
            await expect(
                datasetFactory.connect(owner).setOracle(creator.address)
            ).to.emit(datasetFactory, "OracleUpdated");

            expect(await datasetFactory.oracle()).to.equal(creator.address);
        });
    });

    describe("Emergency Functions", function () {
        it("should allow pausing", async function () {
            await expect(
                datasetFactory.connect(owner).pause()
            ).to.emit(datasetFactory, "Paused");

            expect(await datasetFactory.paused()).to.be.true;
        });

        it("should allow unpausing", async function () {
            await datasetFactory.connect(owner).pause();
            
            await expect(
                datasetFactory.connect(owner).unpause()
            ).to.emit(datasetFactory, "Unpaused");

            expect(await datasetFactory.paused()).to.be.false;
        });
    });
});