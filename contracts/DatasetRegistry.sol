// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Ownable} from "./lib/Ownable.sol";

contract DatasetRegistry is Ownable {
    struct Entry {
        string id; // e.g. "dataset-001"
        string slug; // e.g. "computer-vision-image-classification"
        address token; // ERC20 dataset token
        address creator; // dataset creator EOA
        string metadataCID; // IPFS JSON (name, description, category, etc.)
        string providerId; // off-chain provider id (e.g. "provider-001")
        uint256 createdAt; // block.timestamp at creation
        uint256 updatedAt; // last mutation (e.g., graduation)
        bool exists;
    }

    mapping(bytes32 => Entry) public byKey; // key = keccak256(bytes(id))
    bytes32[] public keys; // iterable list

    event Registered(
        string id,
        string slug,
        address token,
        address creator,
        string metadataCID,
        string providerId
    );
    event Updated(string id, string metadataCID);

    function _key(string memory id_) internal pure returns (bytes32) {
        return keccak256(bytes(id_));
    }

    function register(
        string memory id_,
        string memory slug_,
        address token_,
        address creator_,
        string memory metadataCID_,
        string memory providerId_
    ) external onlyOwner {
        bytes32 k = _key(id_);
        require(!byKey[k].exists, "ID_EXISTS");
        byKey[k] = Entry({
            id: id_,
            slug: slug_,
            token: token_,
            creator: creator_,
            metadataCID: metadataCID_,
            providerId: providerId_,
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            exists: true
        });
        keys.push(k);
        emit Registered(
            id_,
            slug_,
            token_,
            creator_,
            metadataCID_,
            providerId_
        );
    }

    function updateMetadataCID(
        string memory id_,
        string memory newCID
    ) external onlyOwner {
        bytes32 k = _key(id_);
        require(byKey[k].exists, "NOT_FOUND");
        byKey[k].metadataCID = newCID;
        byKey[k].updatedAt = block.timestamp;
        emit Updated(id_, newCID);
    }

    function getCount() external view returns (uint256) {
        return keys.length;
    }

    struct ViewEntry {
        string id;
        string slug;
        address token;
        address creator;
        string metadataCID;
        string providerId;
        uint256 createdAt;
        uint256 updatedAt;
    }

    function getRange(
        uint256 offset,
        uint256 limit
    ) external view returns (ViewEntry[] memory out) {
        uint256 n = keys.length;
        if (offset >= n) return new ViewEntry[](0);
        uint256 end = offset + limit;
        if (end > n) end = n;
        uint256 len = end - offset;
        out = new ViewEntry[](len);
        for (uint256 i = 0; i < len; i++) {
            Entry storage e = byKey[keys[offset + i]];
            out[i] = ViewEntry(
                e.id,
                e.slug,
                e.token,
                e.creator,
                e.metadataCID,
                e.providerId,
                e.createdAt,
                e.updatedAt
            );
        }
    }
}
