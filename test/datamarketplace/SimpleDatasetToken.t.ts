import { ethers } from "hardhat";
import { expect } from "chai";
import { DatasetToken } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("DatasetToken Basic Tests", function () {
    let datasetToken: DatasetToken;
    let creator: SignerWithAddress;
    let user: SignerWithAddress;

    beforeEach(async function () {
        [creator, user] = await ethers.getSigners();

        const DatasetTokenFactory = await ethers.getContractFactory("DatasetToken");
        datasetToken = await DatasetTokenFactory.deploy(
            "Test Dataset",
            "TDS",
            creator.address,
            5
        );
    });

    describe("Deployment", function () {
        it("should deploy with correct parameters", async function () {
            expect(await datasetToken.name()).to.equal("Test Dataset");
            expect(await datasetToken.symbol()).to.equal("TDS");
            expect(await datasetToken.creator()).to.equal(creator.address);
            expect(await datasetToken.burnThresholdPercentage()).to.equal(5);
        });

        it("should have correct initial supply", async function () {
            const totalSupply = await datasetToken.totalSupply();
            const contractBalance = await datasetToken.balanceOf(await datasetToken.getAddress());
            expect(contractBalance).to.equal(totalSupply);
        });

        it("should calculate burn threshold correctly", async function () {
            const threshold = await datasetToken.burnThreshold();
            const totalSupply = await datasetToken.totalSupply();
            const expectedThreshold = (totalSupply * BigInt(5)) / BigInt(100);
            expect(threshold).to.equal(expectedThreshold);
        });
    });

    describe("ERC20 Functionality", function () {
        beforeEach(async function () {
            // Graduate token so owner can transfer from contract
            await datasetToken.connect(creator).graduate();
        });

        it("should transfer tokens", async function () {
            const amount = ethers.parseUnits("1000", 6);
            await expect(
                datasetToken.connect(creator).transfer(user.address, amount)
            ).to.emit(datasetToken, "Transfer");

            expect(await datasetToken.balanceOf(user.address)).to.equal(amount);
        });

        it("should approve and transferFrom", async function () {
            const amount = ethers.parseUnits("1000", 6);
            
            await datasetToken.connect(creator).transfer(user.address, amount);
            await datasetToken.connect(user).approve(creator.address, amount);
            
            await expect(
                datasetToken.connect(creator).transferFrom(user.address, creator.address, amount)
            ).to.not.be.reverted;
        });

        it("should burn tokens", async function () {
            const amount = ethers.parseUnits("1000", 6);
            await datasetToken.connect(creator).transfer(user.address, amount);
            
            const initialSupply = await datasetToken.totalSupply();
            
            await expect(
                datasetToken.connect(user).burn(amount)
            ).to.emit(datasetToken, "Transfer");

            expect(await datasetToken.totalSupply()).to.equal(initialSupply - amount);
        });
    });

    describe("Ownership and Management", function () {
        it("should set bonding curve", async function () {
            await expect(
                datasetToken.connect(creator).setBondingCurve(user.address)
            ).to.emit(datasetToken, "BondingCurveSet");

            expect(await datasetToken.bondingCurve()).to.equal(user.address);
        });

        it("should set burn portal", async function () {
            await expect(
                datasetToken.connect(creator).setBurnPortal(user.address)
            ).to.emit(datasetToken, "BurnPortalSet");

            expect(await datasetToken.burnPortal()).to.equal(user.address);
        });

        it("should graduate successfully", async function () {
            await expect(
                datasetToken.connect(creator).graduate()
            ).to.emit(datasetToken, "Graduated");

            expect(await datasetToken.isGraduated()).to.be.true;
        });

        it("should reject non-owner operations", async function () {
            await expect(
                datasetToken.connect(user).setBondingCurve(user.address)
            ).to.be.revertedWithCustomError(datasetToken, "OwnableUnauthorizedAccount");
        });
    });
});