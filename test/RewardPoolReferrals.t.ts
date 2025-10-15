import { expect } from 'chai'
import { ethers } from 'hardhat'
import {
  RewardPoolFactory,
  RewardPoolImplementation,
  TestToken
} from '../typechain-types'
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import { parseEther, formatEther, parseUnits } from 'ethers'

describe('RewardPool Referrals', function () {
  let factory: RewardPoolFactory
  let implementation: RewardPoolImplementation
  let token: TestToken
  let pool: RewardPoolImplementation
  let poolAddress: string
  
  // Signers
  let owner: HardhatEthersSigner
  let creator: HardhatEthersSigner 
  let farmer: HardhatEthersSigner
  let farmerReferrer: HardhatEthersSigner
  let factoryReferrer: HardhatEthersSigner
  let platformTreasury: HardhatEthersSigner
  let publisher: HardhatEthersSigner
  let guardian: HardhatEthersSigner

  // Test constants
  const REWARD_AMOUNT = parseEther('10') // 10 tokens
  const PLATFORM_FEE_BPS = 1000 // 10%
  const EXPECTED_FEE = parseEther('1') // 1 token (10% of 10)
  const EXPECTED_NET = parseEther('9') // 9 tokens (90% of 10)

  beforeEach(async function () {
    [owner, creator, farmer, farmerReferrer, factoryReferrer, platformTreasury, publisher, guardian] = await ethers.getSigners()

    // Deploy test token
    const TestTokenFactory = await ethers.getContractFactory('TestToken')
    token = await TestTokenFactory.deploy('Test Token', 'TEST', 18)

    // Deploy implementation
    const ImplementationFactory = await ethers.getContractFactory('RewardPoolImplementation')
    implementation = await ImplementationFactory.deploy()

    // Deploy factory
    const FactoryFactory = await ethers.getContractFactory('RewardPoolFactory')
    factory = await FactoryFactory.deploy(
      await implementation.getAddress(),
      platformTreasury.address,
      owner.address, // timelock
      guardian.address,
      publisher.address
    )

    // Allow token
    await factory.connect(owner).setTokenAllowed(await token.getAddress(), true)

    // Create pool
    const tx = await factory.connect(creator).createPool(await token.getAddress())
    const receipt = await tx.wait()
    
    // Extract pool address from event
    const poolCreatedEvent = receipt?.logs.find(log => {
      try {
        const parsed = factory.interface.parseLog({
          topics: log.topics as string[],
          data: log.data
        })
        return parsed?.name === 'PoolCreated'
      } catch {
        return false
      }
    })

    if (!poolCreatedEvent) throw new Error('Pool creation event not found')
    const parsed = factory.interface.parseLog({
      topics: poolCreatedEvent.topics as string[],
      data: poolCreatedEvent.data
    })
    poolAddress = parsed?.args.pool

    // Get pool instance
    pool = await ethers.getContractAt('RewardPoolImplementation', poolAddress)

    // Mint tokens to owner and fund pool
    await token.mint(owner.address, parseEther('10000'))
    await token.transfer(poolAddress, parseEther('1000'))
    await token.connect(creator).approve(poolAddress, parseEther('1000'))
  })

  describe('payWithSigAndReferrals', function () {
    let domain: any
    let types: any
    let cumulativeAmount: bigint
    let nonce: number

    beforeEach(async function () {
      // Setup EIP-712 domain and types
      const chainId = (await ethers.provider.getNetwork()).chainId
      domain = {
        name: 'FactoryVault',
        version: '1',
        chainId: chainId,
        verifyingContract: poolAddress
      }

      types = {
        Claim: [
          { name: 'account', type: 'address' },
          { name: 'cumulativeAmount', type: 'uint256' },
          { name: 'nonce', type: 'uint256' }
        ]
      }

      cumulativeAmount = REWARD_AMOUNT
      nonce = 0
    })

    async function generateSignature(amount: bigint = cumulativeAmount, nonceValue: number = nonce) {
      const message = {
        account: farmer.address,
        cumulativeAmount: amount,
        nonce: nonceValue
      }
      return await publisher.signTypedData(domain, types, message)
    }

    it('should handle single farmer referrer correctly', async function () {
      const farmerReferrerReward = parseEther('0.3') // 30% of 1 ETH fee = 0.3 ETH
      const expectedPlatformFee = EXPECTED_FEE - farmerReferrerReward // 0.7 ETH

      const signature = await generateSignature()
      
      // Record initial balances
      const initialFarmerBalance = await token.balanceOf(farmer.address)
      const initialReferrerBalance = await token.balanceOf(farmerReferrer.address)
      const initialPlatformBalance = await token.balanceOf(platformTreasury.address)

      // Execute claim with single referrer
      const tx = await pool.payWithSigAndReferrals(
        farmer.address,
        cumulativeAmount,
        nonce,
        signature,
        [farmerReferrer.address],
        [farmerReferrerReward]
      )

      // Verify balances
      expect(await token.balanceOf(farmer.address)).to.equal(
        initialFarmerBalance + EXPECTED_NET
      )
      expect(await token.balanceOf(farmerReferrer.address)).to.equal(
        initialReferrerBalance + farmerReferrerReward
      )
      expect(await token.balanceOf(platformTreasury.address)).to.equal(
        initialPlatformBalance + expectedPlatformFee
      )

      // Verify event emission
      await expect(tx)
        .to.emit(pool, 'ReferralReward')
        .withArgs(farmerReferrer.address, farmerReferrerReward, farmer.address)
    })

    it('should handle dual referrers (farmer + factory) correctly', async function () {
      const farmerReferrerReward = parseEther('0.3') // 30% of fee
      const factoryReferrerReward = parseEther('0.5') // 50% of fee
      const expectedPlatformFee = EXPECTED_FEE - farmerReferrerReward - factoryReferrerReward // 0.2 ETH

      const signature = await generateSignature()
      
      // Record initial balances
      const initialFarmerBalance = await token.balanceOf(farmer.address)
      const initialFarmerReferrerBalance = await token.balanceOf(farmerReferrer.address)
      const initialFactoryReferrerBalance = await token.balanceOf(factoryReferrer.address)
      const initialPlatformBalance = await token.balanceOf(platformTreasury.address)

      // Execute claim with both referrers
      const tx = await pool.payWithSigAndReferrals(
        farmer.address,
        cumulativeAmount,
        nonce,
        signature,
        [farmerReferrer.address, factoryReferrer.address],
        [farmerReferrerReward, factoryReferrerReward]
      )

      // Verify balances
      expect(await token.balanceOf(farmer.address)).to.equal(
        initialFarmerBalance + EXPECTED_NET
      )
      expect(await token.balanceOf(farmerReferrer.address)).to.equal(
        initialFarmerReferrerBalance + farmerReferrerReward
      )
      expect(await token.balanceOf(factoryReferrer.address)).to.equal(
        initialFactoryReferrerBalance + factoryReferrerReward
      )
      expect(await token.balanceOf(platformTreasury.address)).to.equal(
        initialPlatformBalance + expectedPlatformFee
      )

      // Verify events
      await expect(tx)
        .to.emit(pool, 'ReferralReward')
        .withArgs(farmerReferrer.address, farmerReferrerReward, farmer.address)
      await expect(tx)
        .to.emit(pool, 'ReferralReward')
        .withArgs(factoryReferrer.address, factoryReferrerReward, farmer.address)
    })

    it('should handle maximum referral distribution (100% to referrers)', async function () {
      const farmerReferrerReward = parseEther('0.6') // 60% of fee
      const factoryReferrerReward = parseEther('0.4') // 40% of fee
      const expectedPlatformFee = 0n // All fee goes to referrers

      const signature = await generateSignature()
      
      const tx = await pool.payWithSigAndReferrals(
        farmer.address,
        cumulativeAmount,
        nonce,
        signature,
        [farmerReferrer.address, factoryReferrer.address],
        [farmerReferrerReward, factoryReferrerReward]
      )

      // Platform should receive nothing when 100% goes to referrers
      const finalPlatformBalance = await token.balanceOf(platformTreasury.address)
      expect(finalPlatformBalance).to.equal(0)
    })

    it('should work with zero referral amounts', async function () {
      const signature = await generateSignature()
      
      const initialPlatformBalance = await token.balanceOf(platformTreasury.address)

      await pool.payWithSigAndReferrals(
        farmer.address,
        cumulativeAmount,
        nonce,
        signature,
        [farmerReferrer.address],
        [0] // Zero referral reward
      )

      // All fee should go to platform when referral amount is 0
      expect(await token.balanceOf(platformTreasury.address)).to.equal(
        initialPlatformBalance + EXPECTED_FEE
      )
      expect(await token.balanceOf(farmerReferrer.address)).to.equal(0)
    })

    it('should maintain backward compatibility with empty referrals', async function () {
      const signature = await generateSignature()
      
      const initialBalances = {
        farmer: await token.balanceOf(farmer.address),
        platform: await token.balanceOf(platformTreasury.address)
      }

      await pool.payWithSigAndReferrals(
        farmer.address,
        cumulativeAmount,
        nonce,
        signature,
        [], // Empty referrals
        []  // Empty amounts
      )

      // Should behave exactly like regular payWithSig
      expect(await token.balanceOf(farmer.address)).to.equal(
        initialBalances.farmer + EXPECTED_NET
      )
      expect(await token.balanceOf(platformTreasury.address)).to.equal(
        initialBalances.platform + EXPECTED_FEE
      )
    })
  })

  describe('Error Handling', function () {
    let signature: string
    
    beforeEach(async function () {
      const domain = {
        name: 'FactoryVault',
        version: '1',
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: poolAddress
      }

      const types = {
        Claim: [
          { name: 'account', type: 'address' },
          { name: 'cumulativeAmount', type: 'uint256' },
          { name: 'nonce', type: 'uint256' }
        ]
      }

      const message = {
        account: farmer.address,
        cumulativeAmount: REWARD_AMOUNT,
        nonce: 0
      }

      signature = await publisher.signTypedData(domain, types, message)
    })

    it('should revert with ReferralLengthMismatch when arrays have different lengths', async function () {
      await expect(
        pool.payWithSigAndReferrals(
          farmer.address,
          REWARD_AMOUNT,
          0,
          signature,
          [farmerReferrer.address, factoryReferrer.address], // 2 addresses
          [parseEther('0.1')] // 1 amount
        )
      ).to.be.revertedWithCustomError(pool, 'ReferralLengthMismatch')
        .withArgs(2, 1)
    })

    it('should revert with TooManyReferrals when more than 2 referrers', async function () {
      const [addr1, addr2, addr3] = await ethers.getSigners()
      
      await expect(
        pool.payWithSigAndReferrals(
          farmer.address,
          REWARD_AMOUNT,
          0,
          signature,
          [addr1.address, addr2.address, addr3.address], // 3 addresses
          [parseEther('0.1'), parseEther('0.1'), parseEther('0.1')]
        )
      ).to.be.revertedWithCustomError(pool, 'TooManyReferrals')
        .withArgs(3, 2)
    })

    it('should revert with ZeroAddressReferrer when referrer is zero address', async function () {
      await expect(
        pool.payWithSigAndReferrals(
          farmer.address,
          REWARD_AMOUNT,
          0,
          signature,
          [ethers.ZeroAddress], // Zero address
          [parseEther('0.1')] // Non-zero amount
        )
      ).to.be.revertedWithCustomError(pool, 'ZeroAddressReferrer')
        .withArgs(0)
    })

    it('should revert with ReferralAmountExceedsFee when referral amounts exceed platform fee', async function () {
      const excessiveAmount = parseEther('2') // 2 ETH > 1 ETH fee
      
      await expect(
        pool.payWithSigAndReferrals(
          farmer.address,
          REWARD_AMOUNT,
          0,
          signature,
          [farmerReferrer.address],
          [excessiveAmount]
        )
      ).to.be.revertedWithCustomError(pool, 'ReferralAmountExceedsFee')
        .withArgs(excessiveAmount, EXPECTED_FEE)
    })

    it('should revert when combined referral amounts exceed fee', async function () {
      const amount1 = parseEther('0.6') // 60% of fee
      const amount2 = parseEther('0.5') // 50% of fee
      const totalAmount = amount1 + amount2 // 110% > 100%
      
      await expect(
        pool.payWithSigAndReferrals(
          farmer.address,
          REWARD_AMOUNT,
          0,
          signature,
          [farmerReferrer.address, factoryReferrer.address],
          [amount1, amount2]
        )
      ).to.be.revertedWithCustomError(pool, 'ReferralAmountExceedsFee')
        .withArgs(totalAmount, EXPECTED_FEE)
    })

    it('should allow zero address referrer with zero amount', async function () {
      // This should NOT revert because amount is 0
      await expect(
        pool.payWithSigAndReferrals(
          farmer.address,
          REWARD_AMOUNT,
          0,
          signature,
          [ethers.ZeroAddress],
          [0] // Zero amount with zero address is OK
        )
      ).to.not.be.reverted
    })
  })

  describe('Edge Cases', function () {
    let signature: string
    
    beforeEach(async function () {
      const domain = {
        name: 'FactoryVault',
        version: '1',
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: poolAddress
      }

      const types = {
        Claim: [
          { name: 'account', type: 'address' },
          { name: 'cumulativeAmount', type: 'uint256' },
          { name: 'nonce', type: 'uint256' }
        ]
      }

      const message = {
        account: farmer.address,
        cumulativeAmount: REWARD_AMOUNT,
        nonce: 0
      }

      signature = await publisher.signTypedData(domain, types, message)
    })

    it('should handle cumulative claims with referrals', async function () {
      // First claim: 10 tokens
      await pool.payWithSigAndReferrals(
        farmer.address,
        parseEther('10'),
        0,
        signature,
        [farmerReferrer.address],
        [parseEther('0.3')] // 30% of 1 ETH fee
      )

      // Second claim: 20 tokens cumulative (10 more)
      const newCumulative = parseEther('20')
      const newNonce = 1
      
      const domain2 = {
        name: 'FactoryVault',
        version: '1',
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: poolAddress
      }

      const types2 = {
        Claim: [
          { name: 'account', type: 'address' },
          { name: 'cumulativeAmount', type: 'uint256' },
          { name: 'nonce', type: 'uint256' }
        ]
      }

      const message2 = {
        account: farmer.address,
        cumulativeAmount: newCumulative,
        nonce: newNonce
      }

      const signature2 = await publisher.signTypedData(domain2, types2, message2)
      
      const initialReferrerBalance = await token.balanceOf(farmerReferrer.address)

      await pool.payWithSigAndReferrals(
        farmer.address,
        newCumulative,
        newNonce,
        signature2,
        [farmerReferrer.address],
        [parseEther('0.3')] // 30% of second claim's fee
      )

      // Referrer should have received referral rewards for both claims
      const finalReferrerBalance = await token.balanceOf(farmerReferrer.address)
      expect(finalReferrerBalance).to.equal(initialReferrerBalance + parseEther('0.3'))
    })

    it('should handle very small referral amounts (wei precision)', async function () {
      const tinyAmount = BigInt(1) // 1 wei
      
      await expect(
        pool.payWithSigAndReferrals(
          farmer.address,
          REWARD_AMOUNT,
          0,
          signature,
          [farmerReferrer.address],
          [tinyAmount]
        )
      ).to.not.be.reverted

      expect(await token.balanceOf(farmerReferrer.address)).to.equal(tinyAmount)
    })

    it('should handle same referrer in both positions', async function () {
      const amount1 = parseEther('0.3')
      const amount2 = parseEther('0.2')
      const totalExpected = amount1 + amount2

      await pool.payWithSigAndReferrals(
        farmer.address,
        REWARD_AMOUNT,
        0,
        signature,
        [farmerReferrer.address, farmerReferrer.address], // Same address twice
        [amount1, amount2]
      )

      // Should receive total from both positions
      expect(await token.balanceOf(farmerReferrer.address)).to.equal(totalExpected)
    })
  })

  describe('Gas Efficiency', function () {
    it('should have reasonable gas costs for single referrer', async function () {
      const domain = {
        name: 'FactoryVault',
        version: '1',
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: poolAddress
      }

      const types = {
        Claim: [
          { name: 'account', type: 'address' },
          { name: 'cumulativeAmount', type: 'uint256' },
          { name: 'nonce', type: 'uint256' }
        ]
      }

      const message = {
        account: farmer.address,
        cumulativeAmount: REWARD_AMOUNT,
        nonce: 0
      }

      const signature = await publisher.signTypedData(domain, types, message)
      
      const tx = await pool.payWithSigAndReferrals(
        farmer.address,
        REWARD_AMOUNT,
        0,
        signature,
        [farmerReferrer.address],
        [parseEther('0.3')]
      )

      const receipt = await tx.wait()
      console.log(`Single referrer gas used: ${receipt?.gasUsed}`)
      
      // Should be reasonable (less than 300k gas)
      expect(receipt?.gasUsed).to.be.lessThan(300000)
    })

    it('should have reasonable gas costs for dual referrers', async function () {
      const domain = {
        name: 'FactoryVault',
        version: '1',
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: poolAddress
      }

      const types = {
        Claim: [
          { name: 'account', type: 'address' },
          { name: 'cumulativeAmount', type: 'uint256' },
          { name: 'nonce', type: 'uint256' }
        ]
      }

      const message = {
        account: farmer.address,
        cumulativeAmount: REWARD_AMOUNT,
        nonce: 0
      }

      const signature = await publisher.signTypedData(domain, types, message)
      
      const tx = await pool.payWithSigAndReferrals(
        farmer.address,
        REWARD_AMOUNT,
        0,
        signature,
        [farmerReferrer.address, factoryReferrer.address],
        [parseEther('0.3'), parseEther('0.2')]
      )

      const receipt = await tx.wait()
      console.log(`Dual referrer gas used: ${receipt?.gasUsed}`)
      
      // Should still be reasonable even with 2 referrers
      expect(receipt?.gasUsed).to.be.lessThan(350000)
    })
  })
})