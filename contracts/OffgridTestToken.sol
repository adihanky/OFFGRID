// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Test-only faucet token. Never deploys on mainnet and never accepts ETH.
contract OffgridTestToken is ERC20 {
    mapping(address => uint256) public nextClaim;
    constructor() ERC20("OFFGRID Test Token", "OGT") {
        require(block.chainid == 11155111 || block.chainid == 31337, "Testnet only");
        _mint(msg.sender, 1000 * 10 ** decimals());
    }
    function claim() external {
        require(block.timestamp >= nextClaim[msg.sender], "Wait before claiming again");
        nextClaim[msg.sender] = block.timestamp + 60;
        _mint(msg.sender, 1000 * 10 ** decimals());
    }
}
