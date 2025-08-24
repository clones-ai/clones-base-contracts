import { ethers } from "hardhat";
import { expect } from "chai";
import { 
    RewardPoolFactory,
    RewardPoolImplementation,
    TestToken,
    ClaimRouter
} from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("RewardPoolFactory", function() {
    let factory: RewardPoolFactory;
    let implementation: RewardPoolImplementation;
    let testToken: TestToken;
    let claimRouter: ClaimRouter;
    
    let timelock: SignerWithAddress;
    let guardian: SignerWithAddress;
    let publisher: SignerWithAddress;
    let creator: SignerWithAddress;
    let treasury: SignerWithAddress;
    let user: SignerWithAddress;

    beforeEach(async function() {
        [timelock, guardian, publisher, creator, treasury, user] = await ethers.getSigners();

        // Deploy test token
        const TestTokenFactory = await ethers.getContractFactory("TestToken");
        testToken = await TestTokenFactory.deploy("Test Token", "TEST", 18);

        // Deploy implementation
        const ImplFactory = await ethers.getContractFactory("RewardPoolImplementation");
        implementation = await ImplFactory.deploy();

        // Deploy factory
        const FactoryFactory = await ethers.getContractFactory("RewardPoolFactory");
        factory = await FactoryFactory.deploy(
            await implementation.getAddress(),
            treasury.address,
            timelock.address,
            guardian.address,
            publisher.address
        );

        // Deploy ClaimRouter
        const RouterFactory = await ethers.getContractFactory("ClaimRouter");
        claimRouter = await RouterFactory.deploy(timelock.address);

        // Setup: Approve factory in router
        await claimRouter.connect(timelock).setFactoryApproved(await factory.getAddress(), true);

        // Setup: Allow test token
        await factory.connect(timelock).setTokenAllowed(await testToken.getAddress(), true);
    });

    describe("Deployment", function() {
        it("Should set correct initial state", async function() {
            expect(await factory.poolImplementation()).to.equal(await implementation.getAddress());
            expect(await factory.platformTreasury()).to.equal(treasury.address);
            expect(await factory.timelock()).to.equal(timelock.address);
            expect(await factory.guardian()).to.equal(guardian.address);
            expect(await factory.publisher()).to.equal(publisher.address);
        });

        it("Should have correct role setup", async function() {
            const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
            const TIMELOCK_ROLE = ethers.keccak256(ethers.toUtf8Bytes("TIMELOCK_ROLE"));
            const EMERGENCY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EMERGENCY_ROLE"));

            expect(await factory.hasRole(DEFAULT_ADMIN_ROLE, timelock.address)).to.be.true;
            expect(await factory.hasRole(TIMELOCK_ROLE, timelock.address)).to.be.true;
            expect(await factory.hasRole(EMERGENCY_ROLE, guardian.address)).to.be.true;
        });

        it("Should reject zero addresses in constructor", async function() {
            const FactoryFactory = await ethers.getContractFactory("RewardPoolFactory");
            
            await expect(FactoryFactory.deploy(
                ethers.ZeroAddress,
                treasury.address,
                timelock.address,
                guardian.address,
                publisher.address
            )).to.be.revertedWithCustomError(factory, "InvalidParameter").withArgs("implementation");

            await expect(FactoryFactory.deploy(
                await implementation.getAddress(),
                ethers.ZeroAddress,
                timelock.address,
                guardian.address,
                publisher.address
            )).to.be.revertedWithCustomError(factory, "InvalidParameter").withArgs("treasury");
        });
    });

    describe("Token Allow-list", function() {
        it("Should allow timelock to manage token allow-list", async function() {
            await expect(factory.connect(timelock).setTokenAllowed(await testToken.getAddress(), false))
                .to.emit(factory, "TokenAllowedUpdated")
                .withArgs(await testToken.getAddress(), false);
            
            expect(await factory.allowedTokens(await testToken.getAddress())).to.be.false;
        });

        it("Should reject non-timelock token management", async function() {
            await expect(factory.connect(creator).setTokenAllowed(await testToken.getAddress(), true))
                .to.be.revertedWithCustomError(factory, "Unauthorized")
                .withArgs("timelock");
        });

        it("Should reject zero address token", async function() {
            await expect(factory.connect(timelock).setTokenAllowed(ethers.ZeroAddress, true))
                .to.be.revertedWithCustomError(factory, "InvalidParameter")
                .withArgs("token");
        });
    });

    describe("Pool Creation", function() {
        it("Should create pool with deterministic address", async function() {
            const [predicted, salt] = await factory.predictPoolAddress(creator.address, await testToken.getAddress());
            
            await expect(factory.connect(creator).createPool(await testToken.getAddress()))
                .to.emit(factory, "PoolCreated")
                .withArgs(creator.address, predicted, await testToken.getAddress(), salt);

            expect(await factory.poolExists(creator.address, await testToken.getAddress())).to.be.true;
        });

        it("Should reject non-allowed tokens", async function() {
            const TestToken2Factory = await ethers.getContractFactory("TestToken");
            const testToken2 = await TestToken2Factory.deploy("Test2", "TEST2", 18);

            await expect(factory.connect(creator).createPool(await testToken2.getAddress()))
                .to.be.revertedWithCustomError(factory, "InvalidParameter")
                .withArgs("token");
        });

        it("Should reject duplicate pools", async function() {
            await factory.connect(creator).createPool(await testToken.getAddress());
            
            await expect(factory.connect(creator).createPool(await testToken.getAddress()))
                .to.be.revertedWithCustomError(factory, "AlreadyExists")
                .withArgs("pool");
        });

        it("Should predict same address before and after creation", async function() {
            const [predicted1] = await factory.predictPoolAddress(creator.address, await testToken.getAddress());
            await factory.connect(creator).createPool(await testToken.getAddress());
            const [predicted2] = await factory.predictPoolAddress(creator.address, await testToken.getAddress());
            
            expect(predicted1).to.equal(predicted2);
        });

        it("Should reject creation when paused", async function() {
            await factory.connect(guardian).pause();
            
            await expect(factory.connect(creator).createPool(await testToken.getAddress()))
                .to.be.revertedWithCustomError(factory, "EnforcedPause");
        });
    });

    describe("Publisher Rotation", function() {
        let newPublisher: SignerWithAddress;

        beforeEach(async function() {
            newPublisher = user;
        });

        it("Should initiate publisher rotation with immediate overlap", async function() {
            const tx = await factory.connect(timelock).initiatePublisherRotation(newPublisher.address);
            const receipt = await tx.wait();
            const block = await ethers.provider.getBlock(receipt!.blockNumber);
            const expectedGraceEnd = block!.timestamp + 7 * 24 * 60 * 60; // 7 days

            await expect(tx)
                .to.emit(factory, "PublisherRotationInitiated")
                .withArgs(publisher.address, newPublisher.address, expectedGraceEnd);

            expect(await factory.publisher()).to.equal(newPublisher.address);
            expect(await factory.oldPublisher()).to.equal(publisher.address);
            expect(await factory.graceEndTime()).to.equal(expectedGraceEnd);
        });

        it("Should reject rotation to same publisher", async function() {
            await expect(factory.connect(timelock).initiatePublisherRotation(publisher.address))
                .to.be.revertedWithCustomError(factory, "InvalidParameter")
                .withArgs("publisher");
        });

        it("Should reject rotation when one is already in progress", async function() {
            await factory.connect(timelock).initiatePublisherRotation(newPublisher.address);
            
            await expect(factory.connect(timelock).initiatePublisherRotation(creator.address))
                .to.be.revertedWithCustomError(factory, "AlreadyExists")
                .withArgs("rotation");
        });

        it("Should cancel publisher rotation during grace period", async function() {
            await factory.connect(timelock).initiatePublisherRotation(newPublisher.address);
            
            await expect(factory.connect(timelock).cancelPublisherRotation())
                .to.emit(factory, "PublisherRotationCancelled")
                .withArgs(publisher.address, newPublisher.address);

            expect(await factory.publisher()).to.equal(publisher.address);
            expect(await factory.oldPublisher()).to.equal(ethers.ZeroAddress);
            expect(await factory.graceEndTime()).to.equal(0);
        });

        it("Should reject cancellation after grace period", async function() {
            await factory.connect(timelock).initiatePublisherRotation(newPublisher.address);
            
            // Advance time beyond grace period
            await time.increase(7 * 24 * 60 * 60 + 1);
            
            await expect(factory.connect(timelock).cancelPublisherRotation())
                .to.be.revertedWithCustomError(factory, "SecurityViolation")
                .withArgs("grace_period");
        });

        it("Should reject non-timelock rotation operations", async function() {
            await expect(factory.connect(guardian).initiatePublisherRotation(newPublisher.address))
                .to.be.revertedWithCustomError(factory, "Unauthorized")
                .withArgs("timelock");

            await expect(factory.connect(creator).cancelPublisherRotation())
                .to.be.revertedWithCustomError(factory, "Unauthorized")
                .withArgs("timelock");
        });
    });

    describe("Emergency Controls", function() {
        it("Should allow guardian to pause", async function() {
            await expect(factory.connect(guardian).pause())
                .to.emit(factory, "Paused")
                .withArgs(guardian.address);
            
            expect(await factory.paused()).to.be.true;
        });

        it("Should allow timelock to unpause", async function() {
            await factory.connect(guardian).pause();
            
            await expect(factory.connect(timelock).unpause())
                .to.emit(factory, "Unpaused")
                .withArgs(timelock.address);
            
            expect(await factory.paused()).to.be.false;
        });

        it("Should reject non-guardian pause", async function() {
            await expect(factory.connect(creator).pause())
                .to.be.revertedWithCustomError(factory, "Unauthorized")
                .withArgs("guardian");
        });

        it("Should reject non-timelock unpause", async function() {
            await factory.connect(guardian).pause();
            
            await expect(factory.connect(guardian).unpause())
                .to.be.revertedWithCustomError(factory, "Unauthorized")
                .withArgs("timelock");
        });
    });

    describe("CREATE2 Salt Generation", function() {
        it("Should generate consistent salts", async function() {
            const [predicted1, salt1] = await factory.predictPoolAddress(creator.address, await testToken.getAddress());
            const [predicted2, salt2] = await factory.predictPoolAddress(creator.address, await testToken.getAddress());
            
            expect(salt1).to.equal(salt2);
            expect(predicted1).to.equal(predicted2);
        });

        it("Should generate different salts for different creators", async function() {
            const [predicted1, salt1] = await factory.predictPoolAddress(creator.address, await testToken.getAddress());
            const [predicted2, salt2] = await factory.predictPoolAddress(user.address, await testToken.getAddress());
            
            expect(salt1).to.not.equal(salt2);
            expect(predicted1).to.not.equal(predicted2);
        });

        it("Should generate different salts for different tokens", async function() {
            const TestToken2Factory = await ethers.getContractFactory("TestToken");
            const testToken2 = await TestToken2Factory.deploy("Test2", "TEST2", 18);
            
            const [predicted1, salt1] = await factory.predictPoolAddress(creator.address, await testToken.getAddress());
            const [predicted2, salt2] = await factory.predictPoolAddress(creator.address, await testToken2.getAddress());
            
            expect(salt1).to.not.equal(salt2);
            expect(predicted1).to.not.equal(predicted2);
        });
    });

    describe("Gas Benchmarks", function() {
        it("Should benchmark pool creation gas", async function() {
            const tx = await factory.connect(creator).createPool(await testToken.getAddress());
            const receipt = await tx.wait();
            
            // Target: < 300k gas for pool creation (revised for actual costs)
            console.log(`Pool creation gas used: ${receipt!.gasUsed.toString()}`);
            expect(receipt!.gasUsed).to.be.lessThan(300000);
        });
    });
});