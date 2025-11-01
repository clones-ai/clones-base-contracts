// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {IERC20} from "./lib/IERC20.sol";
import {Ownable} from "./lib/Ownable.sol";

contract DatasetToken is IERC20, Ownable {
    string public name;
    string public symbol;
    uint8 public constant DECIMALS = 6; // per spec

    uint256 public immutable totalSupply;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    // dataset metadata
    string public datasetCID; // IPFS CID for dataset root (encrypted or plain)
    string public qualityReportCID; // IPFS CID for quality/provenance doc
    address public immutable creator;

    // access
    bool public graduated; // toggled by factory after graduation
    uint256 public immutable burnThreshold; // in tokens (e.g., 50_000_000 * 1e6)

    modifier onlyFactory() {
        require(msg.sender == factory, "NOT_FACTORY");
        _;
    }
    address public factory;

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _supply, // 1_000_000_000 * 1e6
        uint256 _burnThreshold,
        address _creator,
        string memory _datasetCID,
        string memory _qualityReportCID,
        address _factory
    ) {
        require(
            _burnThreshold > 0 && _burnThreshold <= _supply / 10,
            "THRESHOLD_1_10_PCT"
        );
        name = _name;
        symbol = _symbol;
        totalSupply = _supply;
        burnThreshold = _burnThreshold;
        creator = _creator;
        datasetCID = _datasetCID;
        qualityReportCID = _qualityReportCID;
        factory = _factory;
        _balances[_creator] = _supply;
        emit Transfer(address(0), _creator, _supply);
    }

    function decimals() external pure returns (uint8) {
        return DECIMALS;
    }

    // IERC20
    function balanceOf(address a) public view returns (uint256) {
        return _balances[a];
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        _transfer(msg.sender, to, amt);
        return true;
    }

    function allowance(address o, address s) external view returns (uint256) {
        return _allowances[o][s];
    }

    function approve(address s, uint256 amt) external returns (bool) {
        _allowances[msg.sender][s] = amt;
        emit Approval(msg.sender, s, amt);
        return true;
    }

    function transferFrom(
        address f,
        address to,
        uint256 amt
    ) external returns (bool) {
        uint256 a = _allowances[f][msg.sender];
        require(a >= amt, "ALLOW");
        _allowances[f][msg.sender] = a - amt;
        _transfer(f, to, amt);
        return true;
    }

    function _transfer(address f, address t, uint256 amt) internal {
        require(_balances[f] >= amt, "BAL");
        _balances[f] -= amt;
        _balances[t] += amt;
        emit Transfer(f, t, amt);
    }

    // burn used only by BurnPortal post-graduation
    function burnFrom(address from, uint256 amt) external returns (bool) {
        require(graduated, "NOT_GRADUATED");
        require(msg.sender == factory, "ONLY_FACTORY_BURN"); // BurnPortal calls factory -> token
        require(_balances[from] >= amt, "BAL");
        _balances[from] -= amt;
        emit Transfer(from, address(0), amt);
        return true;
    }

    function setGraduated() external onlyFactory {
        graduated = true;
    }
}
