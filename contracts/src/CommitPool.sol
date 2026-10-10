// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title CommitPool — device-verified commitment pools on Monad
/// @notice Members stake the same amount on a daily goal (e.g. "in bed by 23:00").
///         Each day, a member proves the goal with a signed attestation from a device
///         oracle and submits it inside the day's window. Members who complete every day
///         split the stakes of those who didn't. The protocol earns a fee ONLY on
///         forfeited stakes — winners never pay.
/// @dev No admin over funds: treasury, oracle and fee are fixed at deploy. NOT AUDITED.
contract CommitPool {
    // ───────── constants ─────────
    uint8 public constant MIN_MEMBERS = 2;
    uint8 public constant MAX_MEMBERS = 20;
    uint8 public constant MAX_DAYS = 30;
    uint32 public constant MIN_DAY_LENGTH = 60;
    uint16 public constant MAX_FEE_BPS = 2000; // 20% cap

    // ───────── immutable config ─────────
    address public immutable oracle;   // signs device attestations
    address public immutable treasury; // receives protocol fees
    uint16 public immutable feeBps;    // fee on forfeited stakes, in basis points

    // ───────── storage ─────────
    struct Pool {
        address creator;
        uint128 stake;
        uint64 startTime;   // day-0 deadline (e.g. bedtime) as unix time
        uint32 dayLength;   // 86400 in production; 60–120 for live demos
        uint32 window;      // submit allowed at deadline ± window
        uint8 numDays;
        uint8 maxMembers;
        uint8 memberCount;
        uint8 winners;
        bool settled;
        bool cancelled;
        uint256 payout;     // per eligible member after settle
        string goal;        // human-readable goal, e.g. "In bed by 23:00"
    }

    struct Member {
        bool joined;
        bool claimed;
        uint32 doneMask;    // bit d = day d verified
    }

    uint256 public poolCount;
    uint256 public feesAccrued;
    uint256 public totalStaked;   // lifetime, for stats
    mapping(uint256 => Pool) public pools;
    mapping(uint256 => address[]) private _members;
    mapping(uint256 => mapping(address => Member)) public memberState;

    // ───────── events ─────────
    event PoolCreated(uint256 indexed poolId, address indexed creator, string goal, uint256 stake, uint64 startTime, uint32 dayLength, uint32 window, uint8 numDays, uint8 maxMembers);
    event Joined(uint256 indexed poolId, address indexed member);
    event DayVerified(uint256 indexed poolId, address indexed member, uint8 day, uint256 timestamp);
    event PoolCancelled(uint256 indexed poolId);
    event PoolSettled(uint256 indexed poolId, uint8 winners, uint256 payout, uint256 fee);
    event Claimed(uint256 indexed poolId, address indexed member, uint256 amount);
    event FeesWithdrawn(address indexed treasury, uint256 amount);

    // ───────── errors ─────────
    error BadParams();
    error WrongStake();
    error PoolNotFound();
    error JoinClosed();
    error PoolFull();
    error AlreadyMember();
    error NotMember();
    error PoolInactive();
    error OutsideWindow();
    error AlreadyDone();
    error BadSignature();
    error TooEarly();
    error AlreadySettled();
    error NotUnderfilled();
    error NothingToClaim();
    error TransferFailed();

    constructor(address oracle_, address treasury_, uint16 feeBps_) {
        if (oracle_ == address(0) || treasury_ == address(0) || feeBps_ > MAX_FEE_BPS) revert BadParams();
        oracle = oracle_;
        treasury = treasury_;
        feeBps = feeBps_;
    }

    // ───────── views ─────────
    function deadlineOf(uint256 poolId, uint8 day) public view returns (uint256) {
        Pool storage p = pools[poolId];
        return uint256(p.startTime) + uint256(day) * p.dayLength;
    }

    function joinDeadline(uint256 poolId) public view returns (uint256) {
        return uint256(pools[poolId].startTime) - pools[poolId].window;
    }

    /// @notice After this, the pool can be settled (end of the last day's window).
    function endTime(uint256 poolId) public view returns (uint256) {
        Pool storage p = pools[poolId];
        return deadlineOf(poolId, p.numDays - 1) + p.window;
    }

    function getMembers(uint256 poolId) external view returns (address[] memory) {
        return _members[poolId];
    }

    /// @notice Day whose window is open right now.
    function openDay(uint256 poolId) public view returns (bool open, uint8 day) {
        Pool storage p = pools[poolId];
        if (p.dayLength == 0 || block.timestamp + p.window < p.startTime) return (false, 0);
        uint256 d = (block.timestamp + p.window - p.startTime) / p.dayLength;
        if (d >= p.numDays) return (false, 0);
        uint256 dl = uint256(p.startTime) + d * p.dayLength;
        if (block.timestamp <= dl + p.window) return (true, uint8(d));
        return (false, 0);
    }

    /// @notice The hash the oracle signs (EIP-191 personal_sign over this 32-byte value).
    function attestationHash(uint256 poolId, address member, uint8 day) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), poolId, member, day));
    }

    // ───────── lifecycle ─────────
    function createPool(
        string calldata goal,
        uint128 stake,
        uint64 startTime,
        uint32 dayLength,
        uint32 window,
        uint8 numDays,
        uint8 maxMembers
    ) external payable returns (uint256 poolId) {
        if (
            stake == 0 || dayLength < MIN_DAY_LENGTH || window == 0 || uint256(window) * 2 >= dayLength
                || numDays == 0 || numDays > MAX_DAYS || maxMembers < MIN_MEMBERS || maxMembers > MAX_MEMBERS
                || bytes(goal).length == 0 || bytes(goal).length > 80
        ) revert BadParams();
        if (uint256(startTime) <= block.timestamp + window) revert BadParams();
        if (msg.value != stake) revert WrongStake();

        poolId = ++poolCount;
        Pool storage p = pools[poolId];
        p.creator = msg.sender;
        p.stake = stake;
        p.startTime = startTime;
        p.dayLength = dayLength;
        p.window = window;
        p.numDays = numDays;
        p.maxMembers = maxMembers;
        p.goal = goal;
        emit PoolCreated(poolId, msg.sender, goal, stake, startTime, dayLength, window, numDays, maxMembers);
        _addMember(poolId, msg.sender);
    }

    function joinPool(uint256 poolId) external payable {
        Pool storage p = pools[poolId];
        if (p.creator == address(0)) revert PoolNotFound();
        if (p.cancelled || block.timestamp >= joinDeadline(poolId)) revert JoinClosed();
        if (p.memberCount >= p.maxMembers) revert PoolFull();
        if (memberState[poolId][msg.sender].joined) revert AlreadyMember();
        if (msg.value != p.stake) revert WrongStake();
        _addMember(poolId, msg.sender);
    }

    function cancelUnderfilled(uint256 poolId) external {
        Pool storage p = pools[poolId];
        if (p.creator == address(0)) revert PoolNotFound();
        if (p.cancelled) revert PoolInactive();
        if (block.timestamp < joinDeadline(poolId)) revert TooEarly();
        if (p.memberCount >= MIN_MEMBERS) revert NotUnderfilled();
        p.cancelled = true;
        emit PoolCancelled(poolId);
    }

    /// @notice Submit today's device attestation. Must be inside today's window.
    function submit(uint256 poolId, bytes calldata sig) external {
        Pool storage p = pools[poolId];
        Member storage m = memberState[poolId][msg.sender];
        if (!m.joined) revert NotMember();
        if (p.cancelled || p.memberCount < MIN_MEMBERS) revert PoolInactive();
        (bool open, uint8 day) = openDay(poolId);
        if (!open) revert OutsideWindow();
        uint32 bit = uint32(1) << day;
        if (m.doneMask & bit != 0) revert AlreadyDone();
        if (_recover(_ethSigned(attestationHash(poolId, msg.sender, day)), sig) != oracle) revert BadSignature();
        m.doneMask |= bit;
        emit DayVerified(poolId, msg.sender, day, block.timestamp);
    }

    function settle(uint256 poolId) external {
        Pool storage p = pools[poolId];
        if (p.creator == address(0)) revert PoolNotFound();
        if (p.cancelled || p.memberCount < MIN_MEMBERS) revert PoolInactive();
        if (p.settled) revert AlreadySettled();
        if (block.timestamp <= endTime(poolId)) revert TooEarly();

        uint32 all = uint32((uint256(1) << p.numDays) - 1);
        address[] storage list = _members[poolId];
        uint8 w;
        for (uint256 i; i < list.length; ++i) {
            if (memberState[poolId][list[i]].doneMask == all) ++w;
        }
        p.settled = true;
        p.winners = w;

        uint256 n = p.memberCount;
        uint256 stake = p.stake;
        uint256 fee;
        if (w > 0) {
            uint256 forfeit = stake * (n - w);
            fee = forfeit * feeBps / 10_000;
            uint256 share = (forfeit - fee) / w;
            p.payout = stake + share;
            fee += (forfeit - fee) - share * w; // rounding dust → treasury
        } else {
            // nobody completed: the whole pot is forfeited; fee taken, rest refunded equally
            uint256 pot = stake * n;
            fee = pot * feeBps / 10_000;
            uint256 refund = (pot - fee) / n;
            p.payout = refund;
            fee += (pot - fee) - refund * n;
        }
        feesAccrued += fee;
        emit PoolSettled(poolId, w, p.payout, fee);
    }

    function claim(uint256 poolId) external {
        Pool storage p = pools[poolId];
        Member storage m = memberState[poolId][msg.sender];
        if (!m.joined) revert NotMember();
        if (m.claimed) revert NothingToClaim();
        uint256 amount;
        if (p.cancelled) {
            amount = p.stake;
        } else if (p.settled) {
            if (p.winners == 0) amount = p.payout;
            else if (m.doneMask == uint32((uint256(1) << p.numDays) - 1)) amount = p.payout;
        }
        if (amount == 0) revert NothingToClaim();
        m.claimed = true;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Claimed(poolId, msg.sender, amount);
    }

    /// @notice Anyone can push accrued fees to the fixed treasury address.
    function withdrawFees() external {
        uint256 amt = feesAccrued;
        if (amt == 0) revert NothingToClaim();
        feesAccrued = 0;
        (bool ok,) = treasury.call{value: amt}("");
        if (!ok) revert TransferFailed();
        emit FeesWithdrawn(treasury, amt);
    }

    // ───────── internal ─────────
    function _addMember(uint256 poolId, address who) private {
        memberState[poolId][who].joined = true;
        _members[poolId].push(who);
        pools[poolId].memberCount++;
        totalStaked += pools[poolId].stake;
        emit Joined(poolId, who);
    }

    function _ethSigned(bytes32 h) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        // reject malleable signatures (upper-half s)
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
