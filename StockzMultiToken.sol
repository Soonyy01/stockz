// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface INonfungiblePositionManager {
    struct MintParams {
        address token0; address token1; uint24 fee; int24 tickLower; int24 tickUpper;
        uint256 amount0Desired; uint256 amount1Desired; uint256 amount0Min; uint256 amount1Min;
        address recipient; uint256 deadline;
    }
    struct CollectParams { uint256 tokenId; address recipient; uint128 amount0Max; uint128 amount1Max; }
    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool);
    function mint(MintParams calldata params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1);
}

/// @title Stockz multi-pair token (stockz.lat)
/// One fixed-supply ERC-20 paired with up to 12 tokenized stocks on PancakeSwap V3.
/// - No owner, no admin, no mint after deploy, no tax, no blacklist, no pause.
/// - 100% of the supply goes into the pools as single-sided liquidity. The liquidity positions are held by
///   this contract FOREVER: there is no function to remove liquidity or move a position (locked permanently).
/// - Pool fees are collected by this contract and split: holderShareBps to holders (min 10%), the rest to the creator.
///   Holders claim their share with claim(); every reward token is paid at once.
contract StockzMultiToken {
    // ---------------- ERC-20 ----------------
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ---------------- settings (set once in the constructor, no setters) ----------------
    string public constant platform = "stockz.lat";
    uint256 public constant MAX_PAIRS = 12;
    uint256 public constant MIN_HOLDER_SHARE_BPS = 1000;          // 10%
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address public creator;
    uint256 public holderShareBps;
    address public positionManager;
    uint24 public poolFee;
    int24 public tickSpacing;

    // ---------------- pools ----------------
    address[] public stocks;          // pair i = this token / stocks[i]
    int24[] public startTicks;        // log1.0001(stock base units per token base unit), from the creator's chosen market cap
    uint256 public poolsProcessed;    // pools 0..poolsProcessed-1 have been set up
    address[] public pools;           // pool of pair i (zero if it could not be created)
    uint256[] public positionIds;     // locked liquidity position of pair i (0 if none)
    mapping(address => bool) public isPool;
    event PoolCreated(uint256 indexed index, address indexed stock, address pool, uint256 positionId, uint256 tokenAmount);
    event PoolFailed(uint256 indexed index, address indexed stock, uint256 burned);

    // ---------------- dividends ----------------
    // reward 0 = this token, reward i+1 = stocks[i]
    uint256 private constant MAG = 2 ** 128;
    uint256 public constant MIN_ELIGIBLE = 1000 ether;            // below this, holder share goes to the creator (math safety)
    address[] public rewardTokens;
    mapping(uint256 => uint256) public magnifiedPerShare;
    mapping(uint256 => mapping(address => int256)) private corrections;
    mapping(uint256 => mapping(address => uint256)) public withdrawn;
    mapping(uint256 => uint256) public creatorOwed;
    mapping(uint256 => uint256) public totalToHolders;
    mapping(uint256 => uint256) public totalToCreator;
    uint256 public eligibleSupply;                                // supply held by normal wallets (not pools / this contract / dead)
    uint256 private locked = 1;
    event FeesHarvested(uint256 indexed reward, uint256 toHolders, uint256 toCreator);
    event Claimed(address indexed account, uint256 indexed reward, uint256 amount);

    modifier nonReentrant() { require(locked == 1, "busy"); locked = 2; _; locked = 1; }

    constructor(string memory name_, string memory symbol_, address creator_, uint256 holderShareBps_, address positionManager_,
                uint24 poolFee_, int24 tickSpacing_, address[] memory stocks_, int24[] memory startTicks_) {
        uint256 n = stocks_.length;
        require(n >= 1 && n <= MAX_PAIRS, "1-12 pairs");
        require(startTicks_.length == n, "length");
        require(holderShareBps_ >= MIN_HOLDER_SHARE_BPS && holderShareBps_ <= 10000, "holder share 10-100%");
        require(tickSpacing_ > 0, "spacing");
        require(creator_ != address(0), "creator");
        name = name_; symbol = symbol_;
        creator = creator_; holderShareBps = holderShareBps_; positionManager = positionManager_;
        poolFee = poolFee_; tickSpacing = tickSpacing_;
        rewardTokens.push(address(this));
        for (uint256 i = 0; i < n; i++) {
            require(stocks_[i] != address(0) && stocks_[i] != address(this), "stock");
            for (uint256 j = 0; j < i; j++) require(stocks_[j] != stocks_[i], "duplicate");
            stocks.push(stocks_[i]); startTicks.push(startTicks_[i]); rewardTokens.push(stocks_[i]);
            pools.push(address(0)); positionIds.push(0);
        }
        uint256 supply = 1_000_000_000 ether;
        totalSupply = supply; balanceOf[address(this)] = supply;
        emit Transfer(address(0), address(this), supply);
        allowance[address(this)][positionManager_] = type(uint256).max;
    }

    // ---------------- ERC-20 ----------------
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount; emit Approval(msg.sender, spender, amount); return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) { _transfer(msg.sender, to, amount); return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) { require(a >= amount, "allowance"); allowance[from][msg.sender] = a - amount; }
        _transfer(from, to, amount); return true;
    }
    function isExcluded(address a) public view returns (bool) { return a == address(this) || a == DEAD || isPool[a]; }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "zero address");
        uint256 b = balanceOf[from]; require(b >= amount, "balance");
        unchecked { balanceOf[from] = b - amount; }
        balanceOf[to] += amount;
        bool exFrom = isExcluded(from);
        bool exTo = isExcluded(to);
        if (!exFrom) eligibleSupply -= amount;
        if (!exTo) eligibleSupply += amount;
        uint256 r = rewardTokens.length;
        for (uint256 i = 0; i < r; i++) {
            uint256 m = magnifiedPerShare[i]; if (m == 0) continue;
            int256 c = int256(m * amount);
            if (!exFrom) corrections[i][from] += c;
            if (!exTo) corrections[i][to] -= c;
        }
        emit Transfer(from, to, amount);
    }

    // ---------------- pool setup (anyone can run it; the plan is fixed in the constructor) ----------------
    function poolCount() external view returns (uint256) { return stocks.length; }

    function createPools(uint256 count) external nonReentrant {
        uint256 n = stocks.length; uint256 i = poolsProcessed; uint256 end = i + count; if (end > n) end = n;
        require(i < end, "all pools done");
        uint256 per = totalSupply / n;
        for (; i < end; i++) {
            uint256 amount = i == n - 1 ? balanceOf[address(this)] - _reservedSelf() : per;
            address stock = stocks[i];
            bool tIs0 = address(this) < stock;
            (int24 start, int24 lower, int24 upper) = _range(tIs0 ? startTicks[i] : -startTicks[i], tIs0);
            address t0 = tIs0 ? address(this) : stock; address t1 = tIs0 ? stock : address(this);
            address pool = INonfungiblePositionManager(positionManager).createAndInitializePoolIfNecessary(t0, t1, poolFee, getSqrtRatioAtTick(start));
            if (!isPool[pool]) { isPool[pool] = true; uint256 pb = balanceOf[pool]; if (pb > 0) eligibleSupply -= pb; }
            pools[i] = pool;
            require(gasleft() > 1_500_000, "more gas");   // so a mint can only fail for a real reason, not low gas
            try INonfungiblePositionManager(positionManager).mint(INonfungiblePositionManager.MintParams({
                token0: t0, token1: t1, fee: poolFee, tickLower: lower, tickUpper: upper,
                amount0Desired: tIs0 ? amount : 0, amount1Desired: tIs0 ? 0 : amount, amount0Min: 0, amount1Min: 0,
                recipient: address(this), deadline: block.timestamp })) returns (uint256 id, uint128, uint256 a0, uint256 a1) {
                positionIds[i] = id;
                uint256 used = tIs0 ? a0 : a1;
                if (amount > used) _transfer(address(this), DEAD, amount - used);   // rounding dust is burned
                emit PoolCreated(i, stock, pool, id, used);
            } catch {
                _transfer(address(this), DEAD, amount);                              // pool unusable (e.g. pre-set price): its share is burned
                emit PoolFailed(i, stock, amount);
            }
        }
        poolsProcessed = end;
    }

    function _range(int24 tick, bool tIs0) internal view returns (int24 start, int24 lower, int24 upper) {
        int24 s = tickSpacing; int24 maxT = (887272 / s) * s;
        if (tIs0) {                       // token0 only: range above the price
            start = tick / s * s; if (tick % s != 0 && tick > 0) start += s;
            lower = start; upper = maxT;
        } else {                          // token1 only: range below the price
            start = tick / s * s; if (tick % s != 0 && tick < 0) start -= s;
            lower = -maxT; upper = start;
        }
        require(start > -maxT && start < maxT, "price out of range");
    }

    function getSqrtRatioAtTick(int24 tick) internal pure returns (uint160 sqrtPriceX96) {
        unchecked {
        uint256 absTick = tick < 0 ? uint256(-int256(tick)) : uint256(int256(tick));
        require(absTick <= 887272, "T");
        uint256 ratio = absTick & 0x1 != 0 ? 0xfffcb933bd6fad37aa2d162d1a594001 : 0x100000000000000000000000000000000;
        if (absTick & 0x2 != 0) ratio = (ratio * 0xfff97272373d413259a46990580e213a) >> 128;
        if (absTick & 0x4 != 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdcc) >> 128;
        if (absTick & 0x8 != 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0) >> 128;
        if (absTick & 0x10 != 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644) >> 128;
        if (absTick & 0x20 != 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0) >> 128;
        if (absTick & 0x40 != 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861) >> 128;
        if (absTick & 0x80 != 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053) >> 128;
        if (absTick & 0x100 != 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4) >> 128;
        if (absTick & 0x200 != 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54) >> 128;
        if (absTick & 0x400 != 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3) >> 128;
        if (absTick & 0x800 != 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9) >> 128;
        if (absTick & 0x1000 != 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825) >> 128;
        if (absTick & 0x2000 != 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5) >> 128;
        if (absTick & 0x4000 != 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7) >> 128;
        if (absTick & 0x8000 != 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6) >> 128;
        if (absTick & 0x10000 != 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9) >> 128;
        if (absTick & 0x20000 != 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604) >> 128;
        if (absTick & 0x40000 != 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98) >> 128;
        if (absTick & 0x80000 != 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2) >> 128;

        if (tick > 0) ratio = type(uint256).max / ratio;

        sqrtPriceX96 = uint160((ratio >> 32) + (ratio % (1 << 32) == 0 ? 0 : 1));
        }
    }

    // ---------------- fees & dividends ----------------
    uint256 public holderClaimedSelf;   // own-token rewards already paid to holders
    function _reservedSelf() internal view returns (uint256) {
        // own tokens in this contract that belong to holders / creator (unclaimed rewards)
        return creatorOwed[0] + totalToHolders[0] - holderClaimedSelf;
    }

    /// collect the fees of every locked position and split them (anyone can call)
    function harvest() external nonReentrant { _harvest(); }
    function _harvest() internal {
        uint256 r = rewardTokens.length;
        uint256[] memory got = new uint256[](r);
        uint256 n = poolsProcessed;
        for (uint256 i = 0; i < n; i++) {
            uint256 id = positionIds[i]; if (id == 0) continue;
            try INonfungiblePositionManager(positionManager).collect(INonfungiblePositionManager.CollectParams(id, address(this), type(uint128).max, type(uint128).max)) returns (uint256 a0, uint256 a1) {
                bool tIs0 = address(this) < stocks[i];
                got[0] += tIs0 ? a0 : a1;
                got[i + 1] += tIs0 ? a1 : a0;
            } catch {}
        }
        for (uint256 k = 0; k < r; k++) {
            uint256 amt = got[k]; if (amt == 0) continue;
            uint256 toHolders = amt * holderShareBps / 10000;
            if (eligibleSupply < MIN_ELIGIBLE) toHolders = 0;
            if (toHolders > 0) { magnifiedPerShare[k] += toHolders * MAG / eligibleSupply; totalToHolders[k] += toHolders; }
            creatorOwed[k] += amt - toHolders; totalToCreator[k] += amt - toHolders;
            emit FeesHarvested(k, toHolders, amt - toHolders);
        }
    }

    function _accumulated(uint256 k, address a) internal view returns (uint256) {
        int256 v = int256(magnifiedPerShare[k] * balanceOf[a]) + corrections[k][a];
        return v <= 0 ? 0 : uint256(v) / MAG;
    }
    /// rewards already harvested and claimable by an account (call claim() with eth_call to include fees not harvested yet)
    function claimable(address a) public view returns (uint256[] memory out) {
        uint256 r = rewardTokens.length; out = new uint256[](r);
        if (isExcluded(a)) return out;
        for (uint256 k = 0; k < r; k++) { uint256 acc = _accumulated(k, a); uint256 w = withdrawn[k][a]; out[k] = acc > w ? acc - w : 0; }
    }

    /// harvest pool fees, then pay the caller every reward it has earned as a holder
    function claim() external nonReentrant returns (uint256[] memory paid) {
        _harvest();
        paid = claimable(msg.sender);
        for (uint256 k = 0; k < paid.length; k++) {
            uint256 amt = paid[k]; if (amt == 0) continue;
            withdrawn[k][msg.sender] += amt;
            if (!_pay(k, msg.sender, amt)) { withdrawn[k][msg.sender] -= amt; paid[k] = 0; continue; }
            if (k == 0) holderClaimedSelf += amt;
            emit Claimed(msg.sender, k, amt);
        }
    }

    /// harvest pool fees, then pay the creator its share (anyone can call; funds only go to the creator)
    function claimCreator() external nonReentrant returns (uint256[] memory paid) {
        _harvest();
        uint256 r = rewardTokens.length; paid = new uint256[](r);
        for (uint256 k = 0; k < r; k++) {
            uint256 amt = creatorOwed[k]; if (amt == 0) continue;
            creatorOwed[k] = 0;
            if (!_pay(k, creator, amt)) { creatorOwed[k] = amt; continue; }
            paid[k] = amt;
            emit Claimed(creator, k, amt);
        }
    }

    function _pay(uint256 k, address to, uint256 amt) internal returns (bool) {
        if (k == 0) { _transfer(address(this), to, amt); return true; }
        (bool ok, bytes memory data) = rewardTokens[k].call(abi.encodeWithSelector(0xa9059cbb, to, amt));
        return ok && (data.length == 0 || abi.decode(data, (bool)));
    }

    // ---------------- views for the site ----------------
    function info() external view returns (address[] memory stocks_, address[] memory pools_, uint256[] memory positionIds_, address[] memory rewards_, uint256 holderShareBps_, address creator_, uint256 processed_) {
        return (stocks, pools, positionIds, rewardTokens, holderShareBps, creator, poolsProcessed);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) { return this.onERC721Received.selector; }
}
