// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {CommitPool} from "../src/CommitPool.sol";

/// Env: ORACLE (address of the oracle signer), TREASURY (fee recipient), FEE_BPS (e.g. 1000 = 10%)
contract Deploy is Script {
    function run() external returns (CommitPool cp) {
        address oracle = vm.envAddress("ORACLE");
        address treasury = vm.envAddress("TREASURY");
        uint16 feeBps = uint16(vm.envOr("FEE_BPS", uint256(1000)));
        vm.startBroadcast();
        cp = new CommitPool(oracle, treasury, feeBps);
        vm.stopBroadcast();
        console.log("CommitPool deployed at:", address(cp));
    }
}
