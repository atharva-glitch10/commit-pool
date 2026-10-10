// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CommitPool} from "../src/CommitPool.sol";

contract CommitPoolTest is Test {
    CommitPool cp;
    uint256 oracleKey = 0xA11CE;
    address oracle;
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address dave = makeAddr("dave");

    uint128 constant STAKE = 1 ether;
    uint32 constant DAY = 120;
    uint32 constant WIN = 30;
    uint64 start;

    function setUp() public {
        oracle = vm.addr(oracleKey);
        cp = new CommitPool(oracle, treasury, 1000); // 10% fee on forfeits
        vm.warp(1_000_000);
        start = uint64(block.timestamp + 300);
        for (uint256 i; i < 4; ++i) vm.deal([alice, bob, carol, dave][i], 10 ether);
    }

    function _create(uint8 days_, uint8 max) internal returns (uint256 id) {
        vm.prank(alice);
        id = cp.createPool{value: STAKE}("In bed by 23:00", STAKE, start, DAY, WIN, days_, max);
    }

    function _join(uint256 id, address who) internal {
        vm.prank(who);
        cp.joinPool{value: STAKE}(id);
    }

    function _sig(uint256 key, uint256 id, address who, uint8 day) internal view returns (bytes memory) {
        bytes32 h = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", cp.attestationHash(id, who, day)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, h);
        return abi.encodePacked(r, s, v);
    }

    function _submit(uint256 id, address who, uint8 day) internal {
        bytes memory s = _sig(oracleKey, id, who, day);
        vm.prank(who);
        cp.submit(id, s);
    }

    function _claimDelta(uint256 id, address who) internal returns (uint256) {
        uint256 b = who.balance;
        vm.prank(who);
        cp.claim(id);
        return who.balance - b;
    }

    // 3 members, 3 days, carol misses day 1 → alice & bob split 90% of carol's stake, 10% to treasury
    function test_WinnersSplitMinusFee() public {
        uint256 id = _create(3, 3);
        _join(id, bob);
        _join(id, carol);
        for (uint8 d; d < 3; ++d) {
            vm.warp(cp.deadlineOf(id, d));
            _submit(id, alice, d);
            _submit(id, bob, d);
            if (d != 1) _submit(id, carol, d);
        }
        vm.warp(cp.endTime(id) + 1);
        cp.settle(id);
        assertEq(_claimDelta(id, alice), 1.45 ether);
        assertEq(_claimDelta(id, bob), 1.45 ether);
        vm.prank(carol);
        vm.expectRevert(CommitPool.NothingToClaim.selector);
        cp.claim(id);
        assertEq(cp.feesAccrued(), 0.1 ether);
        cp.withdrawFees();
        assertEq(treasury.balance, 0.1 ether);
        assertEq(address(cp).balance, 0);
    }

    function test_AllWinNoFee() public {
        uint256 id = _create(1, 2);
        _join(id, bob);
        vm.warp(cp.deadlineOf(id, 0));
        _submit(id, alice, 0);
        _submit(id, bob, 0);
        vm.warp(cp.endTime(id) + 1);
        cp.settle(id);
        assertEq(_claimDelta(id, alice), STAKE);
        assertEq(_claimDelta(id, bob), STAKE);
        assertEq(cp.feesAccrued(), 0);
    }

    function test_NobodyWinsFeeThenRefund() public {
        uint256 id = _create(2, 2);
        _join(id, bob);
        vm.warp(cp.endTime(id) + 1);
        cp.settle(id);
        assertEq(_claimDelta(id, alice), 0.9 ether);
        assertEq(_claimDelta(id, bob), 0.9 ether);
        assertEq(cp.feesAccrued(), 0.2 ether);
    }

    function test_DustGoesToTreasury() public {
        // 3 members, 1 winner... make forfeit not divisible: 4 members, 3 winners
        uint256 id = _create(1, 4);
        _join(id, bob);
        _join(id, carol);
        _join(id, dave);
        vm.warp(cp.deadlineOf(id, 0));
        _submit(id, alice, 0);
        _submit(id, bob, 0);
        _submit(id, carol, 0);
        vm.warp(cp.endTime(id) + 1);
        cp.settle(id);
        uint256 a = _claimDelta(id, alice);
        _claimDelta(id, bob);
        _claimDelta(id, carol);
        assertEq(a, STAKE + (0.9 ether) / 3);
        assertEq(address(cp).balance, cp.feesAccrued()); // everything left is accounted fees
        cp.withdrawFees();
        assertEq(address(cp).balance, 0);
    }

    function test_ForgedSignatureRejected() public {
        uint256 id = _create(1, 2);
        _join(id, bob);
        vm.warp(cp.deadlineOf(id, 0));
        bytes memory bad = _sig(0xBAD, id, alice, 0);
        vm.prank(alice);
        vm.expectRevert(CommitPool.BadSignature.selector);
        cp.submit(id, bad);
    }

    function test_CannotReuseSomeoneElsesSignature() public {
        uint256 id = _create(1, 2);
        _join(id, bob);
        vm.warp(cp.deadlineOf(id, 0));
        bytes memory aliceSig = _sig(oracleKey, id, alice, 0);
        vm.prank(bob);
        vm.expectRevert(CommitPool.BadSignature.selector);
        cp.submit(id, aliceSig);
    }

    function test_CannotReuseSignatureOnAnotherDay() public {
        uint256 id = _create(2, 2);
        _join(id, bob);
        vm.warp(cp.deadlineOf(id, 0));
        bytes memory s0 = _sig(oracleKey, id, alice, 0);
        vm.prank(alice);
        cp.submit(id, s0);
        vm.warp(cp.deadlineOf(id, 1));
        vm.prank(alice);
        vm.expectRevert(CommitPool.BadSignature.selector);
        cp.submit(id, s0);
    }

    function test_OutsideWindowRejected() public {
        uint256 id = _create(1, 2);
        _join(id, bob);
        vm.warp(cp.deadlineOf(id, 0) + WIN + 1);
        bytes memory s = _sig(oracleKey, id, alice, 0);
        vm.prank(alice);
        vm.expectRevert(CommitPool.OutsideWindow.selector);
        cp.submit(id, s);
    }

    function test_WindowEdgesAccepted() public {
        uint256 id = _create(1, 2);
        _join(id, bob);
        vm.warp(cp.deadlineOf(id, 0) - WIN);
        _submit(id, alice, 0);
        vm.warp(cp.deadlineOf(id, 0) + WIN);
        _submit(id, bob, 0);
    }

    function test_DoubleSubmitRejected() public {
        uint256 id = _create(1, 2);
        _join(id, bob);
        vm.warp(cp.deadlineOf(id, 0));
        _submit(id, alice, 0);
        bytes memory s = _sig(oracleKey, id, alice, 0);
        vm.prank(alice);
        vm.expectRevert(CommitPool.AlreadyDone.selector);
        cp.submit(id, s);
    }

    function test_OutsiderCannotSubmit() public {
        uint256 id = _create(1, 2);
        _join(id, bob);
        vm.warp(cp.deadlineOf(id, 0));
        bytes memory s = _sig(oracleKey, id, dave, 0);
        vm.prank(dave);
        vm.expectRevert(CommitPool.NotMember.selector);
        cp.submit(id, s);
    }

    function test_EarlySettleAndDoubleSettleRejected() public {
        uint256 id = _create(1, 2);
        _join(id, bob);
        vm.warp(cp.endTime(id));
        vm.expectRevert(CommitPool.TooEarly.selector);
        cp.settle(id);
        vm.warp(cp.endTime(id) + 1);
        cp.settle(id);
        vm.expectRevert(CommitPool.AlreadySettled.selector);
        cp.settle(id);
    }

    function test_DoubleClaimRejected() public {
        uint256 id = _create(1, 2);
        _join(id, bob);
        vm.warp(cp.endTime(id) + 1);
        cp.settle(id);
        _claimDelta(id, alice);
        vm.prank(alice);
        vm.expectRevert(CommitPool.NothingToClaim.selector);
        cp.claim(id);
    }

    function test_UnderfilledCancelRefundsFully() public {
        uint256 id = _create(3, 3);
        vm.expectRevert(CommitPool.TooEarly.selector);
        cp.cancelUnderfilled(id);
        vm.warp(cp.joinDeadline(id));
        cp.cancelUnderfilled(id);
        assertEq(_claimDelta(id, alice), STAKE);
    }

    function test_JoinRules() public {
        uint256 id = _create(1, 2);
        vm.prank(bob);
        vm.expectRevert(CommitPool.WrongStake.selector);
        cp.joinPool{value: 1}(id);
        vm.prank(alice);
        vm.expectRevert(CommitPool.AlreadyMember.selector);
        cp.joinPool{value: STAKE}(id);
        _join(id, bob);
        vm.prank(carol);
        vm.expectRevert(CommitPool.PoolFull.selector);
        cp.joinPool{value: STAKE}(id);
        uint256 id2 = _create(1, 3);
        vm.warp(cp.joinDeadline(id2));
        vm.prank(bob);
        vm.expectRevert(CommitPool.JoinClosed.selector);
        cp.joinPool{value: STAKE}(id2);
    }

    function test_BadParamsRejected() public {
        vm.startPrank(alice);
        vm.expectRevert(CommitPool.BadParams.selector);
        cp.createPool{value: STAKE}("x", STAKE, start, DAY, DAY / 2, 1, 2); // overlapping windows
        vm.expectRevert(CommitPool.BadParams.selector);
        cp.createPool{value: STAKE}("x", STAKE, start, DAY, WIN, 31, 2); // too many days
        vm.expectRevert(CommitPool.BadParams.selector);
        cp.createPool{value: STAKE}("", STAKE, start, DAY, WIN, 1, 2); // empty goal
        vm.expectRevert(CommitPool.BadParams.selector);
        cp.createPool{value: STAKE}("x", STAKE, uint64(block.timestamp), DAY, WIN, 1, 2); // start in past
        vm.expectRevert(CommitPool.WrongStake.selector);
        cp.createPool{value: 1}("x", STAKE, start, DAY, WIN, 1, 2);
        vm.stopPrank();
    }

    function test_FeeCapAndZeroAddressesRejected() public {
        vm.expectRevert(CommitPool.BadParams.selector);
        new CommitPool(oracle, treasury, 2001);
        vm.expectRevert(CommitPool.BadParams.selector);
        new CommitPool(address(0), treasury, 100);
    }

    function testFuzz_MoneyConserved(uint8 n, uint8 winMask, uint16 fee) public {
        n = uint8(bound(n, 2, 4));
        fee = uint16(bound(fee, 0, 2000));
        CommitPool c = new CommitPool(oracle, treasury, fee);
        cp = c;
        address[4] memory ppl = [alice, bob, carol, dave];
        vm.prank(alice);
        uint256 id = c.createPool{value: 0.3 ether}("goal", 0.3 ether, start, DAY, WIN, 1, n);
        for (uint256 i = 1; i < n; ++i) { vm.prank(ppl[i]); c.joinPool{value: 0.3 ether}(id); }
        vm.warp(c.deadlineOf(id, 0));
        for (uint256 i; i < n; ++i) if (winMask & (1 << i) != 0) _submit(id, ppl[i], 0);
        vm.warp(c.endTime(id) + 1);
        c.settle(id);
        uint256 paid;
        for (uint256 i; i < n; ++i) {
            uint256 b = ppl[i].balance;
            vm.prank(ppl[i]);
            try c.claim(id) { paid += ppl[i].balance - b; } catch {}
        }
        assertEq(paid + c.feesAccrued(), 0.3 ether * uint256(n));
        assertEq(address(c).balance, c.feesAccrued());
    }
}
