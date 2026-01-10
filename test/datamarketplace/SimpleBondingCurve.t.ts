import { ethers } from "hardhat";
import { expect } from "chai";
import { BondingCurve, DatasetToken } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("BondingCurve Basic Tests", function () {
    let bondingCurve: BondingCurve;
    let datasetToken: DatasetToken;
    let creator: SignerWithAddress;
    let buyer: SignerWithAddress;
    let graduationManager: SignerWithAddress;

    beforeEach(async function () {
        [creator, buyer, graduationManager] = await ethers.getSigners();

        // Deploy DatasetToken
        const DatasetTokenFactory = await ethers.getContractFactory("DatasetToken");
        datasetToken = await DatasetTokenFactory.deploy(
            "Test Dataset",
            "TDS",
            creator.address,
            5
        );

        // Deploy BondingCurve with initial liquidity
        const BondingCurveFactory = await ethers.getContractFactory("BondingCurve");
        bondingCurve = await BondingCurveFactory.deploy(
            await datasetToken.getAddress(),
            creator.address,
            creator.address,
            graduationManager.address,
            { value: ethers.parseEther("1") }
        );
    });

    describe("Basic Functionality", function () {
        it("should deploy correctly", async function () {
            expect(await bondingCurve.CREATOR()).to.equal(creator.address);
            expect(await bondingCurve.isActive()).to.be.true;
        });

        it("should calculate tokens out", async function () {
            const ethIn = ethers.parseEther("1");
            const tokensOut = await bondingCurve.getTokensOut(ethIn);
            expect(tokensOut).to.be.greaterThan(0);
        });

        it("should get current price", async function () {
            const price = await bondingCurve.getCurrentPrice();
            expect(price).to.be.greaterThan(0);
        });
    });

    describe("Trading", function () {
        beforeEach(async function () {
            await datasetToken.connect(creator).setBondingCurve(await bondingCurve.getAddress());
        });

        it("should allow token purchase", async function () {
            const purchaseAmount = ethers.parseEther("0.1");
            const tokensOut = await bondingCurve.getTokensOut(purchaseAmount);
            
            await expect(
                bondingCurve.connect(buyer).buy(tokensOut, { value: purchaseAmount })
            ).to.not.be.reverted;

            expect(await datasetToken.balanceOf(buyer.address)).to.equal(tokensOut);
        });

        it("should revert invalid purchases", async function () {
            await expect(
                bondingCurve.connect(buyer).buy(0, { value: 0 })
            ).to.be.revertedWithCustomError(bondingCurve, "NoETHSent");
        });
    });
});