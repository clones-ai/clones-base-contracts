import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { RewardPoolFactory, RewardPoolImplementation, TestToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { parseEther, keccak256, solidityPackedKeccak256 } from "ethers";

describe("Publisher Rotation Race Conditions", function () {
  let factory: RewardPoolFactory;
  let implementation: RewardPoolImplementation;
  let vault: RewardPoolImplementation;
  let testToken: TestToken;

  let timelock: SignerWithAddress;
  let guardian: SignerWithAddress;
  let treasury: SignerWithAddress;
  let creator: SignerWithAddress;
  let publisher1: SignerWithAddress;
  let publisher2: SignerWithAddress;
  let publisher3: SignerWithAddress;
  let claimer1: SignerWithAddress;
  let claimer2: SignerWithAddress;

  const CLAIM_AMOUNT = parseEther("100");
  const MIN_ROTATION_INTERVAL = 3600; // 1 hour in seconds
  const PUBLISHER_GRACE_PERIOD = 7 * 24 * 3600; // 7 days in seconds
  const SHORT_GRACE_PERIOD = 300; // 5 minutes for testing

  // Helper function to sign claims
  async function signClaim(
    signer: SignerWithAddress,
    vaultAddress: string,
    account: string,
    cumulativeAmount: bigint
  ) {
    const domain = {
      name: "FactoryVault",
      version: "1",
      chainId: await signer.provider!.getNetwork().then(n => n.chainId),
      verifyingContract: vaultAddress
    };

    const types = {
      Claim: [
        { name: "account", type: "address" },
        { name: "cumulativeAmount", type: "uint256" },
        { name: "nonce", type: "uint256" }
      ]
    };

    // Get nonce from contract
    const vaultContract = await ethers.getContractAt("RewardPoolImplementation", vaultAddress) as RewardPoolImplementation;
    const nonce = await vaultContract.claimNonce(account);

    const value = {
      account,
      cumulativeAmount,
      nonce: nonce.toString()
    };
    return await signer.signTypedData(domain, types, value);
  }

  beforeEach(async function () {
    [timelock, guardian, treasury, creator, publisher1, publisher2, publisher3, claimer1, claimer2] =
      await ethers.getSigners();

    // Deploy test token
    const TestTokenFactory = await ethers.getContractFactory("TestToken");
    testToken = await TestTokenFactory.deploy("Test Token", "TEST", 18);

    // Deploy implementation
    const RewardPoolImplFactory = await ethers.getContractFactory("RewardPoolImplementation");
    implementation = await RewardPoolImplFactory.deploy();

    // Deploy factory
    const RewardPoolFactoryContract = await ethers.getContractFactory("RewardPoolFactory");
    factory = await RewardPoolFactoryContract.deploy(
      await implementation.getAddress(),
      treasury.address,
      timelock.address,
      guardian.address,
      publisher1.address // Initial publisher
    );

    // Allow test token
    await factory.connect(timelock).setTokenAllowed(await testToken.getAddress(), true);

    // Create a vault
    await factory.connect(creator).createPool(await testToken.getAddress());
    const [poolAddress] = await factory.predictPoolAddressWithNonce(creator.address, await testToken.getAddress(), 0);
    vault = RewardPoolImplFactory.attach(poolAddress) as RewardPoolImplementation;

    // Fund the vault
    await testToken.mint(creator.address, parseEther("10000"));
    await testToken.connect(creator).approve(poolAddress, parseEther("10000"));
    await vault.connect(creator).fund(parseEther("10000"));
  });

  describe("Cooldown Protection", function () {
    it("Should enforce MIN_ROTATION_INTERVAL cooldown", async function () {
      // First rotation should work (should set lastRotationTime)
      await expect(factory.connect(timelock).initiatePublisherRotation(publisher2.address))
        .to.emit(factory, "PublisherRotationInitiated");

      // Cancel the rotation immediately to clear grace period but keep lastRotationTime
      await factory.connect(timelock).cancelPublisherRotation();

      // Now try immediate rotation - should fail due to cooldown
      await expect(factory.connect(timelock).initiatePublisherRotation(publisher3.address))
        .to.be.revertedWithCustomError(factory, "SecurityViolation")
        .withArgs("cooldown_active");

      // After cooldown period, rotation should work
      await time.increase(MIN_ROTATION_INTERVAL + 1);

      await expect(factory.connect(timelock).initiatePublisherRotation(publisher3.address))
        .to.emit(factory, "PublisherRotationInitiated");
    });

    it("Should reset cooldown on cancellation", async function () {
      // Initiate rotation
      await factory.connect(timelock).initiatePublisherRotation(publisher2.address);

      // Cancel rotation (should update lastRotationTime)
      await factory.connect(timelock).cancelPublisherRotation();

      // Immediate new rotation should fail due to cooldown
      await expect(factory.connect(timelock).initiatePublisherRotation(publisher2.address))
        .to.be.revertedWithCustomError(factory, "SecurityViolation")
        .withArgs("cooldown_active");
    });

    it("Should allow rotation after grace period ends naturally", async function () {
      // Initiate rotation
      await factory.connect(timelock).initiatePublisherRotation(publisher2.address);

      // Wait for grace period to end (which is much longer than MIN_ROTATION_INTERVAL)
      await time.increase(PUBLISHER_GRACE_PERIOD + 1);

      // Since PUBLISHER_GRACE_PERIOD (7 days) >> MIN_ROTATION_INTERVAL (1 hour),
      // the cooldown should be expired by now
      await expect(factory.connect(timelock).initiatePublisherRotation(publisher3.address))
        .to.emit(factory, "PublisherRotationInitiated");
    });
  });

  describe("Atomic Publisher Updates", function () {
    it("Should update all state atomically in initiatePublisherRotation", async function () {
      const initialPublisher = await factory.publisher();
      const initialOldPublisher = await factory.oldPublisher();
      const initialGraceEndTime = await factory.graceEndTime();
      const initialLastRotationTime = await factory.lastRotationTime();

      // Perform rotation
      const tx = await factory.connect(timelock).initiatePublisherRotation(publisher2.address);
      const receipt = await tx.wait();
      const blockTimestamp = await ethers.provider.getBlock(receipt!.blockNumber).then(b => b!.timestamp);

      // Verify all state updated correctly
      expect(await factory.publisher()).to.equal(publisher2.address);
      expect(await factory.oldPublisher()).to.equal(initialPublisher);
      expect(await factory.graceEndTime()).to.equal(blockTimestamp + PUBLISHER_GRACE_PERIOD);
      expect(await factory.lastRotationTime()).to.equal(blockTimestamp);
    });

    it("Should update all state atomically in cancelPublisherRotation", async function () {
      // First initiate rotation
      await factory.connect(timelock).initiatePublisherRotation(publisher2.address);
      const publisherBeforeCancel = await factory.publisher();
      const oldPublisherBeforeCancel = await factory.oldPublisher();

      // Cancel rotation
      const tx = await factory.connect(timelock).cancelPublisherRotation();
      const receipt = await tx.wait();
      const blockTimestamp = await ethers.provider.getBlock(receipt!.blockNumber).then(b => b!.timestamp);

      // Verify all state updated atomically
      expect(await factory.publisher()).to.equal(oldPublisherBeforeCancel); // Restored
      expect(await factory.oldPublisher()).to.equal(ethers.ZeroAddress); // Cleared
      expect(await factory.graceEndTime()).to.equal(0); // Cleared
      expect(await factory.lastRotationTime()).to.equal(blockTimestamp); // Updated
    });
  });

  describe("Concurrent Claims During Rotation", function () {
    it("Should handle claims from both publishers during grace period", async function () {
      // Sign claims with both publishers before rotation
      const signature1 = await signClaim(publisher1, await vault.getAddress(), claimer1.address, CLAIM_AMOUNT);

      // Initiate rotation
      await factory.connect(timelock).initiatePublisherRotation(publisher2.address);

      // Sign claim with new publisher after rotation
      const signature2 = await signClaim(publisher2, await vault.getAddress(), claimer2.address, CLAIM_AMOUNT);

      // Both should work during grace period
      const nonce = await
        vault.claimNonce(claimer1.address);
      await expect(vault.connect(claimer1).payWithSig(claimer1.address, CLAIM_AMOUNT, nonce, signature1))
        .to.emit(vault, "ClaimedMinimal");

      const nonce2 = await
        vault.claimNonce(claimer2.address);
      await expect(vault.connect(claimer2).payWithSig(claimer2.address, CLAIM_AMOUNT, nonce2, signature2))
        .to.emit(vault, "ClaimedMinimal");
    });

    it("Should reject old publisher after grace period", async function () {
      // Sign claim with old publisher
      const signature = await signClaim(publisher1, await vault.getAddress(), claimer1.address, CLAIM_AMOUNT);

      // Initiate rotation
      await factory.connect(timelock).initiatePublisherRotation(publisher2.address);

      // Wait for grace period to end
      await time.increase(PUBLISHER_GRACE_PERIOD + 1);

      // Old publisher should be rejected
      const nonce = await
        vault.claimNonce(claimer1.address);
      await expect(vault.connect(claimer1).payWithSig(claimer1.address, CLAIM_AMOUNT, nonce, signature))
        .to.be.revertedWithCustomError(vault, "SecurityViolation")
        .withArgs("signature");
    });

    it("Should handle rapid successive claims during rotation", async function () {
      // Initiate rotation
      await factory.connect(timelock).initiatePublisherRotation(publisher2.address);

      // Prepare claim data with both publishers
      const claims = [];
      for (let i = 0; i < 5; i++) {
        const amount = CLAIM_AMOUNT * BigInt(i + 1);
        claims.push({
          signer: i % 2 === 0 ? publisher1 : publisher2,
          account: i % 2 === 0 ? claimer1 : claimer2,
          amount
        });
      }

      // Execute all claims - sign just before execution to get correct nonce
      for (const claim of claims) {
        const signature = await signClaim(
          claim.signer,
          await vault.getAddress(),
          claim.account.address,
          claim.amount
        );
        const nonce = await vault.claimNonce(claim.account.address);
        await expect(vault.connect(claim.account).payWithSig(claim.account.address, claim.amount, nonce, signature))
          .to.emit(vault, "ClaimedMinimal");
      }
    });
  });

  describe("Publisher Rotation Edge Cases", function () {
    it("Should prevent rotation during active rotation", async function () {
      // Initiate first rotation
      await factory.connect(timelock).initiatePublisherRotation(publisher2.address);

      // Wait for cooldown to expire but keep grace period active
      await time.increase(MIN_ROTATION_INTERVAL + 1);

      // Second rotation should fail due to active grace period
      await expect(factory.connect(timelock).initiatePublisherRotation(publisher3.address))
        .to.be.revertedWithCustomError(factory, "AlreadyExists")
        .withArgs("rotation");
    });

    it("Should handle rotation to same publisher after grace period", async function () {
      // Initiate rotation
      await factory.connect(timelock).initiatePublisherRotation(publisher2.address);

      // Wait for grace period to end + cooldown
      await time.increase(PUBLISHER_GRACE_PERIOD + MIN_ROTATION_INTERVAL + 1);

      // Rotation back to original publisher should work
      await expect(factory.connect(timelock).initiatePublisherRotation(publisher1.address))
        .to.emit(factory, "PublisherRotationInitiated");
    });

    it("Should reject invalid publisher addresses", async function () {
      await expect(factory.connect(timelock).initiatePublisherRotation(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(factory, "InvalidParameter")
        .withArgs("publisher");

      await expect(factory.connect(timelock).initiatePublisherRotation(publisher1.address))
        .to.be.revertedWithCustomError(factory, "InvalidParameter")
        .withArgs("publisher");
    });

    it("Should handle cancellation edge cases", async function () {
      // Cancel without active rotation should fail
      await expect(factory.connect(timelock).cancelPublisherRotation())
        .to.be.revertedWithCustomError(factory, "InvalidParameter")
        .withArgs("no_rotation");

      // Start rotation
      await factory.connect(timelock).initiatePublisherRotation(publisher2.address);

      // Wait for grace period to end
      await time.increase(PUBLISHER_GRACE_PERIOD + 1);

      // Cancel after grace period should fail
      await expect(factory.connect(timelock).cancelPublisherRotation())
        .to.be.revertedWithCustomError(factory, "SecurityViolation")
        .withArgs("grace_period");
    });

    it("Should maintain publisher state consistency across multiple rotations", async function () {
      const rotations = [
        { from: publisher1.address, to: publisher2.address },
        { from: publisher2.address, to: publisher3.address },
        { from: publisher3.address, to: publisher1.address }
      ];

      for (let i = 0; i < rotations.length; i++) {
        const rotation = rotations[i];

        // Verify initial state
        expect(await factory.publisher()).to.equal(rotation.from);

        // Wait for cooldown if needed
        if (i > 0) {
          await time.increase(MIN_ROTATION_INTERVAL + 1);
        }

        // Perform rotation
        await factory.connect(timelock).initiatePublisherRotation(rotation.to);

        // Verify state consistency
        expect(await factory.publisher()).to.equal(rotation.to);
        expect(await factory.oldPublisher()).to.equal(rotation.from);
        expect(await factory.graceEndTime()).to.be.greaterThan(await time.latest());

        // Wait for grace period to complete rotation
        await time.increase(PUBLISHER_GRACE_PERIOD + 1);
      }
    });
  });

  describe("Emergency Publisher Revocation During Rotation", function () {
    it("Should revoke publishers during active rotation", async function () {
      // Initiate rotation
      await factory.connect(timelock).initiatePublisherRotation(publisher2.address);

      // Revoke old publisher during grace period
      await factory.connect(guardian).emergencyRevokePublisher(publisher1.address, "Compromised key");

      // Old publisher should be rejected even during grace period
      const signature = await signClaim(publisher1, await vault.getAddress(), claimer1.address, CLAIM_AMOUNT);
      const nonce = await
        vault.claimNonce(claimer1.address);
      await expect(vault.connect(claimer1).payWithSig(claimer1.address, CLAIM_AMOUNT, nonce, signature))
        .to.be.revertedWithCustomError(vault, "SecurityViolation")
        .withArgs("signature");

      // New publisher should still work
      const signature2 = await signClaim(publisher2, await vault.getAddress(), claimer2.address, CLAIM_AMOUNT);
      const nonce2 = await
        vault.claimNonce(claimer2.address);
      await expect(vault.connect(claimer2).payWithSig(claimer2.address, CLAIM_AMOUNT, nonce2, signature2))
        .to.emit(vault, "ClaimedMinimal");
    });

    it("Should revoke new publisher during grace period", async function () {
      // Initiate rotation
      await factory.connect(timelock).initiatePublisherRotation(publisher2.address);

      // Revoke new publisher during grace period
      await factory.connect(guardian).emergencyRevokePublisher(publisher2.address, "Compromised key");

      // New publisher should be rejected
      const signature2 = await signClaim(publisher2, await vault.getAddress(), claimer2.address, CLAIM_AMOUNT);
      const nonce = await
        vault.claimNonce(claimer2.address);
      await expect(vault.connect(claimer2).payWithSig(claimer2.address, CLAIM_AMOUNT, nonce, signature2))
        .to.be.revertedWithCustomError(vault, "SecurityViolation")
        .withArgs("signature");

      // Old publisher should still work during grace period (if not revoked)
      const signature1 = await signClaim(publisher1, await vault.getAddress(), claimer1.address, CLAIM_AMOUNT);
      const nonce1 = await
        vault.claimNonce(claimer1.address);
      await expect(vault.connect(claimer1).payWithSig(claimer1.address, CLAIM_AMOUNT, nonce1, signature1))
        .to.emit(vault, "ClaimedMinimal");
    });
  });

  describe("Gas Usage and Performance", function () {
    it("Should have reasonable gas usage for publisher rotation", async function () {
      const tx = await factory.connect(timelock).initiatePublisherRotation(publisher2.address);
      const receipt = await tx.wait();

      // Gas usage should be reasonable (< 100k gas)
      expect(receipt!.gasUsed).to.be.lessThan(100000);
    });

    it("Should handle publisher validation efficiently during high load", async function () {
      // Initiate rotation
      await factory.connect(timelock).initiatePublisherRotation(publisher2.address);

      // Simulate high load with multiple sequential claims (not parallel to avoid race conditions)
      // Use increasing cumulative amounts for the same claimer
      let claimer1Amount = CLAIM_AMOUNT;
      let claimer2Amount = CLAIM_AMOUNT;

      for (let i = 0; i < 10; i++) {
        const signer = i % 2 === 0 ? publisher1 : publisher2;
        const claimer = i % 2 === 0 ? claimer1 : claimer2;

        // Increase cumulative amount for each claim
        if (i % 2 === 0) {
          claimer1Amount += CLAIM_AMOUNT;
          const signature = await signClaim(signer, await vault.getAddress(), claimer1.address, claimer1Amount);
          const nonce = await
            vault.claimNonce(claimer1.address);
          await vault.connect(claimer1).payWithSig(claimer1.address, claimer1Amount, nonce, signature);
        } else {
          claimer2Amount += CLAIM_AMOUNT;
          const signature = await signClaim(signer, await vault.getAddress(), claimer2.address, claimer2Amount);
          const nonce = await
            vault.claimNonce(claimer2.address);
          await vault.connect(claimer2).payWithSig(claimer2.address, claimer2Amount, nonce, signature);
        }
      }
    });
  });
});