# Echidna Fuzzing Guide - Clones Reward Pool

## Overview

This guide covers the Echidna fuzzing setup for the Clones reward pool smart contracts. Echidna is a property-based fuzzer that generates random inputs to test smart contract invariants.

## Installation

### Option 1: Homebrew (macOS)
```bash
brew install echidna
```

### Option 2: Docker
```bash
docker pull trailofbits/echidna
```

### Option 3: Binary Releases
Download from: https://github.com/crytic/echidna/releases

## Test Contracts

### ⭐ EchidnaRewardPoolFuzzer.sol (OPERATIONAL)
Tests **the core RewardPoolImplementation logic** - claims, fees, security:

**Fuzzing Functions:**
- `fuzz_fund(uint256)` - Random pool funding
- `fuzz_claim(uint8, uint256)` - Random claims with cumulative amounts
- `fuzz_withdraw(uint256)` - Random creator withdrawals

**Invariants Tested (8 critical):**
- `echidna_balance_conservation()` - Pool balance + claims ≤ total supplied
- `echidna_claims_monotonic()` - User claims never decrease
- `echidna_global_consistency()` - Global claims = sum of individual claims
- `echidna_fee_accuracy()` - Fee calculations are accurate (10%)
- `echidna_rate_limit()` - Rate limits are respected (50/block)
- `echidna_min_claim()` - Minimum claim amounts enforced
- `echidna_nonce_validity()` - Nonces only increase
- `echidna_never_insolvent()` - Pool balance never negative

### ⭐ EchidnaFactoryFuzzer.sol (OPERATIONAL)
Tests **the factory operations and governance**:

**Fuzzing Functions:**
- `fuzz_rotate_publisher(uint8)` - Random publisher rotations
- `fuzz_cancel_rotation()` - Random rotation cancellations
- `fuzz_revoke_publisher(uint8)` - Random publisher revocations
- `fuzz_create_pool(uint8, uint256)` - Random pool creations
- `fuzz_token_allowlist(uint8, bool)` - Random allowlist changes
- `fuzz_factory_pause()` / `fuzz_factory_unpause()` - Pause testing

**Invariants Tested (10 critical):**
- `echidna_publisher_never_zero()` - Publisher address never zero
- `echidna_immutables_unchanged()` - Immutable addresses stay fixed
- `echidna_cooldown_enforced()` - Cooldown periods respected (1 hour)
- `echidna_grace_period_logic()` - Grace period logic correct
- `echidna_revoked_invalid()` - Revoked publishers can't sign
- `echidna_atomic_transition()` - State transitions are atomic
- `echidna_nonce_increases()` - Pool nonces only increase
- `echidna_implementation_valid()` - Proxy implementation valid
- `echidna_no_time_overflow()` - Timestamp calculations safe
- `echidna_rotation_count_sane()` - State tracking consistent

### 📚 EchidnaRewardPoolTest.sol (REFERENCE ONLY)
⚠️ **Does not compile** - kept as reference for complex testing strategies.
Use `EchidnaRewardPoolFuzzer.sol` instead.

### 📚 EchidnaFactoryTest.sol (REFERENCE ONLY)
⚠️ **Does not compile** - kept as reference for factory testing strategies.
Use `EchidnaFactoryFuzzer.sol` instead.

## Configuration

The `echidna.yaml` file configures the fuzzing campaign:

```yaml
testMode: property       # Test invariant properties
testLimit: 50000        # Number of transactions to generate
shrinkLimit: 5000       # Number of tries to shrink failing cases
seqLen: 100             # Transactions per sequence
coverage: true          # Enable coverage-guided fuzzing
timeout: 86400          # 24 hour timeout
```

## Running Echidna

### Quick Start (RECOMMENDED)
```bash
# Install Echidna first (see installation options above)

# Run RewardPool CORE fuzzing (10 min, 5000 tests)
echidna . --contract EchidnaRewardPoolFuzzer --config echidna-rewardpool.yaml

# Run Factory CORE fuzzing (10 min, 3000 tests)
echidna . --contract EchidnaFactoryFuzzer --config echidna-factory.yaml
```

### Quick Test (2 minutes)
```bash
# Token + basic tests
echidna . --contract EchidnaTokenTest --config echidna-quick.yaml
```

### Manual Execution (Alternative)
```bash
# Compile contracts
npx hardhat compile

# Run RewardPool fuzzing
echidna . --contract EchidnaRewardPoolFuzzer --config echidna-rewardpool.yaml

# Run Factory fuzzing
echidna . --contract EchidnaFactoryFuzzer --config echidna-factory.yaml
```

### Docker Usage
```bash
# Run with Docker
docker run -it -v $(pwd):/src trailofbits/echidna \
  echidna /src --contract EchidnaRewardPoolFuzzer \
  --config /src/echidna-rewardpool.yaml
```

## Interpreting Results

### Success Output
```
echidna_balance_conservation: passing ✅
echidna_claims_monotonic: passing ✅
echidna_fee_accuracy: passing ✅
echidna_publisher_never_zero: passing ✅
...

Unique instructions: 4303
Total calls: 5098
```

### Failure Output
```
echidna_balance_conservation: failed! 💥
  Call sequence:
    1. fuzz_fund(1000000000000000000000)
    2. fuzz_claim(2, 2000000000000000000000)
    3. fuzz_withdraw(500000000000000000000)
  
  Resulting state violates property
```

### Coverage Information
Echidna will generate coverage information showing which code paths were explored during fuzzing.

## Corpus Management

Echidna saves interesting test cases in the `corpus/` directory:
- These represent inputs that trigger unique code paths
- Failed test cases are preserved for debugging
- Can be replayed for deterministic testing

## Advanced Configuration

### Custom Fuzzing Targets
Modify config YAML to focus on specific functions:
```yaml
filterFunctions: [
  "fuzz_fund(uint256)",
  "fuzz_claim(uint8,uint256)"
]
```

### Increased Test Intensity
For deeper testing, increase limits:
```yaml
testLimit: 100000       # More transactions
shrinkLimit: 10000      # More shrinking attempts
timeout: 172800         # 48 hour timeout
```

### Multi-Worker Fuzzing
Enable parallel fuzzing:
```yaml
campaignConf:
  workers: 4            # Use 4 parallel workers
```

## Expected Findings

Echidna may discover:
1. **Edge cases** in mathematical calculations
2. **Race conditions** in state transitions
3. **Unexpected interactions** between functions
4. **Boundary conditions** that break invariants
5. **Gas limit issues** in complex transactions

## Integrating with CI/CD

Add to GitHub Actions:
```yaml
- name: Install Echidna
  run: |
    wget https://github.com/crytic/echidna/releases/latest/download/echidna-test-2.0.5-Linux.tar.gz
    tar -xf echidna-test-2.0.5-Linux.tar.gz
    sudo mv echidna-test /usr/local/bin/

- name: Run Echidna Fuzzing (Quick)
  run: |
    echidna . --contract EchidnaTokenTest --config echidna-quick.yaml

- name: Run Echidna Fuzzing (Core Contracts - Optional)
  run: |
    echidna . --contract EchidnaRewardPoolFuzzer --config echidna-rewardpool.yaml
    echidna . --contract EchidnaFactoryFuzzer --config echidna-factory.yaml
```

## Debugging Failed Properties

1. **Examine the call sequence** that triggered the failure
2. **Reproduce manually** with the exact same inputs
3. **Add debug functions** to test contracts for state inspection
4. **Modify invariants** if they're too restrictive
5. **Fix underlying bugs** in the main contracts

## Best Practices

1. **Start with simple invariants** and gradually add complexity
2. **Use coverage-guided fuzzing** to explore more code paths
3. **Run long fuzzing campaigns** (24+ hours) for comprehensive testing
4. **Combine with other testing** - unit tests, integration tests, formal verification
5. **Monitor resource usage** - Echidna can be memory/CPU intensive

## Troubleshooting

### Common Issues
- **Compilation errors**: Ensure Solidity version matches project
- **Timeout errors**: Increase timeout or reduce test complexity
- **Memory issues**: Reduce testLimit or use fewer workers
- **False positives**: Refine invariant conditions

### Debug Mode
Enable verbose output:
```bash
echidna-test --debug contracts/echidna/EchidnaRewardPoolTest.sol
```

## Security Impact

Echidna fuzzing helps discover:
- **Arithmetic vulnerabilities** (overflow, underflow)
- **Logic errors** in complex state machines
- **Economic exploits** through unexpected input combinations
- **Denial of service** vectors via resource exhaustion
- **Invariant violations** that could lead to fund loss

## Conclusion

Echidna provides automated property-based testing that complements traditional testing methods. The investment in setting up comprehensive fuzzing pays dividends in discovering edge cases and vulnerabilities that manual testing might miss.

For questions or issues with Echidna setup, refer to:
- [Echidna Documentation](https://github.com/crytic/echidna/wiki)
- [Trail of Bits Blog](https://blog.trailofbits.com/tag/echidna/)
- [Building Secure Contracts](https://github.com/crytic/building-secure-contracts/tree/master/program-analysis/echidna)