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

        // Deploy a mock CLONES token for testing with high initial supply
        const MockTokenFactory = await ethers.getContractFactory("TestToken");
        const mockClonesToken = await MockTokenFactory.deploy("CLONES", "CLONES", 18);
        
        // Mint tokens to owner first
        await mockClonesToken.mint(owner.address, ethers.parseEther("100000"));

        // Deploy implementations
        const DatasetTokenImplFactory = await ethers.getContractFactory("DatasetTokenImplementation");
        const tokenImpl = await DatasetTokenImplFactory.deploy();

        const BondingCurveImplFactory = await ethers.getContractFactory("BondingCurveImplementation");
        const curveImpl = await BondingCurveImplFactory.deploy();

        // Deploy DatasetFactory with correct constructor params
        const DatasetFactoryFactory = await ethers.getContractFactory("DatasetFactory");
        datasetFactory = await DatasetFactoryFactory.deploy(
            await tokenImpl.getAddress(),
            await curveImpl.getAddress(),
            await mockClonesToken.getAddress(),
            owner.address, // protocol fee recipient
            owner.address, // timelock
            owner.address, // guardian
            "0x0000000000000000000000000000000000000001", // CLONES/USD price feed (mock)
            "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1", // ETH/USD price feed (Base Sepolia)
            ethers.parseEther("100") // fallback launch fee
        );

        // Give creator some CLONES tokens
        await mockClonesToken.transfer(creator.address, ethers.parseEther("1000"));
        await mockClonesToken.connect(creator).approve(await datasetFactory.getAddress(), ethers.parseEther("1000"));

        // Deploy and configure required managers for dataset creation
        const GraduationManagerFactory = await ethers.getContractFactory("GraduationManager");
        const graduationManager = await GraduationManagerFactory.deploy(
            "0x4200000000000000000000000000000000000006", // Mock Uniswap V2 Factory
            "0x4200000000000000000000000000000000000006", // Mock Uniswap V2 Router
            "0x4200000000000000000000000000000000000006", // Mock WETH
            owner.address, // timelock
            owner.address  // guardian
        );

        const BurnPortalFactory = await ethers.getContractFactory("BurnPortal");
        const burnPortal = await BurnPortalFactory.deploy(
            owner.address, // timelock
            owner.address  // guardian
        );

        // Configure factory with required addresses
        await datasetFactory.setGraduationManager(await graduationManager.getAddress());
        await datasetFactory.setBurnPortal(await burnPortal.getAddress());
    });

    describe("Deployment", function () {
        it("should deploy with correct parameters", async function () {
            expect(await datasetFactory.PROTOCOL_FEE_RECIPIENT()).to.equal(owner.address);
            expect(await datasetFactory.TIMELOCK()).to.equal(owner.address);
            expect(await datasetFactory.GUARDIAN()).to.equal(owner.address);
        });

        it("should have correct fallback launch fee", async function () {
            expect(await datasetFactory.fallbackLaunchFee()).to.equal(ethers.parseEther("100"));
        });

        it("should have correct price feeds", async function () {
            expect(await datasetFactory.CLONES_USD_PRICE_FEED()).to.equal("0x0000000000000000000000000000000000000001");
            expect(await datasetFactory.ETH_USD_PRICE_FEED()).to.equal("0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1");
        });

        it("should be ready for dataset creation after managers setup", async function () {
            expect(await datasetFactory.isReadyForDatasetCreation()).to.equal(true);
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

        it("should get creator nonce", async function () {
            const nonce = await datasetFactory.creatorNonce(creator.address);
            expect(nonce).to.equal(0);
        });
    });

    describe("Access Control", function () {
        it("should have correct roles", async function () {
            const adminRole = await datasetFactory.DEFAULT_ADMIN_ROLE();
            expect(await datasetFactory.hasRole(adminRole, owner.address)).to.be.true;
        });

        it("should allow role queries", async function () {
            const timelockRole = await datasetFactory.TIMELOCK_ROLE();
            const emergencyRole = await datasetFactory.EMERGENCY_ROLE();
            
            expect(await datasetFactory.hasRole(timelockRole, owner.address)).to.be.true;
            expect(await datasetFactory.hasRole(emergencyRole, owner.address)).to.be.true;
        });
    });

    describe("Oracle Management", function () {
        it("should start with oracle enabled", async function () {
            expect(await datasetFactory.useOracle()).to.be.true;
        });

        it("should have graduation and burn portal setters", async function () {
            await expect(
                datasetFactory.connect(owner).setGraduationManager(creator.address)
            ).to.emit(datasetFactory, "GraduationManagerUpdated");

            expect(await datasetFactory.graduationManager()).to.equal(creator.address);
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