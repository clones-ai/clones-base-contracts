// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {RewardPool} from "contracts/RewardPool.sol";

/// @title MaliciousERC20
/// @notice An ERC20 token that attempts a reentrancy attack upon transfer.
/// @dev Used for testing the reentrancy guard of the RewardPool.
contract MaliciousERC20 is ERC20 {
    address private _rewardPool;
    address private _attacker;
    bytes private _attackPayload;

    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

    /// @notice Sets up the attack parameters.
    /// @param rewardPool The address of the RewardPool contract to attack.
    /// @param attacker The address of the attacker account.
    /// @param attackPayload The encoded function call for the reentrant attack.
    function setAttack(
        address rewardPool,
        address attacker,
        bytes calldata attackPayload
    ) public {
        _rewardPool = rewardPool;
        _attacker = attacker;
        _attackPayload = attackPayload;
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override {
        // Normal transfer logic
        super._update(from, to, value);

        // Reentrancy attack condition:
        // - Attack is armed (_rewardPool is set).
        // - The transfer is coming FROM the RewardPool contract.
        // - The transfer is going TO the attacker.
        if (
            _rewardPool != address(0) && from == _rewardPool && to == _attacker
        ) {
            (bool success, ) = _rewardPool.call(_attackPayload);
            require(success, "Attack call failed");
        }
    }
}
