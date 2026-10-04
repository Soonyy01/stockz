// Stockz config. Everything on-chain is read live from BNB Smart Chain (mainnet). Nothing is simulated.
window.FLAPCITY_CONFIG = {
  chainId: 56,
  rpcUrls: [                                   // tried in order; ones that refuse eth_getLogs or rate-limit are skipped automatically
    "https://bsc-rpc.publicnode.com",
    "https://bsc.drpc.org",
    "https://binance.llamarpc.com",
    "https://1rpc.io/bnb",
    "https://bsc-dataseed.binance.org",
    "https://bsc-dataseed1.defibit.io"
  ],
  // flap Portal on BSC. Same address appears in Bitquery's flap docs and in a public flap demo repo.
  // Re-check it on BscScan if you want to be 100% sure: https://bscscan.com/address/0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0
  portal: "0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0",
  // Official flap docs: event TokenCreated(uint256 ts, address creator, uint256 nonce, address token, string name, string symbol, string meta)
  // topic0 = keccak256("TokenCreated(uint256,address,uint256,address,string,string,string)"), verified locally.
  topicTokenCreated: "0x504e7f360b2e5fe33cbaaae4c593bc55305328341bf79009e43e0e3b7f699603",
  lookbackHours: 24,      // how far back to scan for new tokens (older tokens are not drawn)
  maxTokens: 300,
  listFromTs: 1791097200,  // only tokens launched from 2026-10-04 07:00 UTC (14:00 WIB) are shown; earlier test launches are hidden          // newest N tokens are drawn
  // Stock tokens with their BSC addresses, supplied by the Stockz owner from the official list (checksum checked).
  // Used to (1) detect which stock a token is paired with and (2) fill the Multi-pair picker.
  // Missing addresses (not yet supplied): AGPUB, CYPHB, TLT.
  stockTokens: [
    { t:'XAUT', address:'0x21cAef8A43163Eea865baeE23b9C2E327696A3bf' },
    { t:'SPCXB', address:'0xbe9D156892E55e7154BcD3cB0FEA677F9D3103E1' },
    { t:'SKHYB', address:'0xca750ef65f295bbecd685abf54e82caf297bdb61' },
    { t:'SPYB', address:'0x7138b48df7d98d7e3cc221bfe7192d0a178182d8' },
    { t:'QQQB', address:'0x205812cdbed920aff76c6580abd681a46d11efc7' },
    { t:'NVDAB', address:'0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436' },
    { t:'AAPLB', address:'0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a' },
    { t:'TSLAB', address:'0x5b1910eAaD6450E50f816082Aa078C41F10C292f' },
    { t:'WENB', address:'0xDed1c5FB38C262beb9CfF1E1116EfF3c5bf278Cd' },
    { t:'PDDB', address:'0x95b0409679B55C31772daA2fB4bEE7B125B77521' },
    { t:'FWDIB', address:'0x83f1A739FAE6517c4672c5E10c8ea918925eB584' },
    { t:'SHAZB', address:'0x0f31E21B7881F5583EA94ddBCb0bCaf22B1aBeAb' },
    { t:'ADBEB', address:'0x65c0249d49E3231540Fd0db0a1ae9259e6eAaf57' },
    { t:'HPEB', address:'0xd56Eb30d2Ea7b5866DC0066D33BbaaB36f7e8860' },
    { t:'ZMB', address:'0xF4DDb292Fe88E476edDD9869d386705E6BFab7A2' },
    { t:'MSFTB', address:'0x80106cb3ead06659a5ad19df39d9b4733863b9b0' },
    { t:'GOOGLB', address:'0x3f53de71c126bdabae20f9cd64848d317f6c3238' },
    { t:'HOODB', address:'0xa394dcea3fd3847fd793afbfd163e2e3858b7c65' },
    { t:'BABAB', address:'0x4ef9d3062c7f6eba4aae4990c5036598c6eff4ec' },
    { t:'GMEB', address:'0x46cEeFDa28Dd7207059ed19B0acdc026955bb15C' },
    { t:'NFLXB', address:'0xd6829ea836b6fa224d099d40e54b31262f874631' },
    { t:'MSTRB', address:'0xe87afb3076aeb0f9b14e368de8145ae6a2826a14' },
    { t:'DJTB', address:'0xF2ec508422174Ee564de98187db9359D318AFB6b' },
    { t:'SOXSB', address:'0xe28cd11c99af2df76bb8ada4cd0ef3904378280f' },
    { t:'SOXLB', address:'0xd97d097a89113fa59b76c572e5b2eb647e8eefaf' },
    { t:'MRNAB', address:'0x5fd86da9b05abe396fe9d02a4a213a7c00556503' },
    { t:'FLNCB', address:'0x4af1d41cd9dd950dca43984b43aaa2a8702714ac' },
    { t:'BMNRB', address:'0x3548da95a9effe481e8604664d75e95821e557f5' },
    { t:'BNCB', address:'0x4902C5ebc598265Ed2212b559B042De8a5Eeec3f' },
    { t:'SMCIB', address:'0x387dea1d2772d716d081a29116f3effa0ffe1f36' },
    { t:'IRENB', address:'0xfdc2f2cab77b28f7ef6c819a404706cfa9bca33b' },
    { t:'ASMLB', address:'0xfbfb4f79cfb4c34dcd7c82bdee5a0fa199b2e7f9' },
    { t:'ASTSB', address:'0x58b6f5feeb8436489f5bf4a56619092b1fa8e777' },
    { t:'COHRB', address:'0x5131859a059b2446abeefe0f5d313b3c54ff3d36' },
    { t:'CRDOB', address:'0x6e7d451f9d30327d32020f116fa79c23b24e9c8d' },
    { t:'USARB', address:'0xcd345d4450e04cdef422a60b97d9265d24e0bcee' },
    { t:'ALABB', address:'0x1282493ede6a22753d45cb2c0fdbd8d35e97555a' },
    { t:'CRCLB', address:'0x80f3D493EBCe97e343c53D29a137942416B4ffC0' },
    { t:'MUB', address:'0xcdf2f3e0fa43C47A6662a91C9E4a7C5f69762699' },
    { t:'SNDKB', address:'0x3eE4dF61bd4F867E349BEaE8bFE07bc31b4850fb' },
    { t:'AMDB', address:'0x75fd4cf6f8392e41e70391d60c90c0d5211603a1' },
    { t:'EWYB', address:'0xbe82f76637dba2c114c41df856c2c51e522e2cb8' },
    { t:'INTCB', address:'0xe614e2fc6c787035ff51f452e8e826bfd32d5283' },
    { t:'LITEB', address:'0x64748bea17b6d19e242adf20425de2440c656142' },
    { t:'METAB', address:'0x7425889fe94f9d693e8daefe88bcced6acfef4c0' },
    { t:'PLTRB', address:'0x0ca5d51d0277bd006fd9607d3e560785ebad8222' },
    { t:'BEB', address:'0x5519de00f5388c17d886b97cb5d2d43a812a82bc' },
    { t:'AMZNB', address:'0x1a4b499833a79a09ad7cf1d42d7dacf71e92eb00' },
    { t:'DELLB', address:'0x0e7a51966c66648999d506e1372efdea1b78cb0b' },
    { t:'AMATB', address:'0xa304bd78e739c0f777202b3eb73ac3736d1df801' },
    { t:'PYPLB', address:'0x2806a561fc1f9259b2d54a281796bde0d92762ae' },
    { t:'GSB', address:'0x20cce6656e5f7f79f280e2d0f5db55b401bdbfce' },
    { t:'SMHB', address:'0xbe1fced7047fdce935f45700727845df2c76877a' },
    { t:'QCOMB', address:'0x5f7a56e877b9130608bf8be962621011182fefe1' },
    { t:'COINB', address:'0x585bde7c54abb5ccd7791f923d6c2187635f3952' },
    { t:'WDCB', address:'0xebe29695f8047c13d36e7a790ca8c1b239ffad1c' },
    { t:'GLWB', address:'0x740e075cbbea22a082b9d6679e65e82767875b6a' },
    { t:'NBISB', address:'0xe256bc2a4f5297f8ba6f043f180a46300ecbcbb1' },
    { t:'DRAMB', address:'0x93862d63fd9fd488b1328e9b47717d75e994a84b' },
    { t:'CBRSB', address:'0xe81c6bb0266cd68b4f17278531dd03ea1f12da4e' },
    { t:'ARMB', address:'0xd42a79ebb7f527f40faecd196ffb47ad5e8d6f8c' },
    { t:'AAOIB', address:'0x10343ef7da3301493d7ecb647d68a288c6c1db2f' },
    { t:'RKLBB', address:'0xc8da12cbcce7c45180692a6420b0076e03a5179a' },
    { t:'NOKB', address:'0x7c4d7a180d737dd5a70d8065a90e6746a69c37ea' },
    { t:'TSMB', address:'0xab78b89b5bb00236be0b4b20704cbfa04efc711c' },
    { t:'AVGOB', address:'0x76682c454467b3a1150ad8b6a92fc5ee2c21d7ed' },
    { t:'MRVLB', address:'0x16cd4fe7e8880ecc3ba222795229e20489fc2c76' },
    { t:'IBMB', address:'0xfa273b076feb8c0fb34e554ae341082323d016a3' },
    { t:'KORUB', address:'0x1ffad32d69c5fead99f88c25ca0191edc3757636' },
    { t:'AXTIB', address:'0x9bdc8b470dbf89dbcb123587c6f5e49cca3463be' },
    { t:'CRWVB', address:'0x33e7317e17838fee56b10fe8d0b9ca6ca3090c95' },
    { t:'MUUB', address:'0x0bb3fa77e0809f42948e435f04883c25415e8263' },
    { t:'MVLLB', address:'0x7c26a12f20507e2cee22ceebed9e88fda47f866c' },
    { t:'SNXXB', address:'0x9e82e3da8f1115b73d24bb24113ab836ffdab6b6' },
    { t:'INTWB', address:'0x0735d9904b7e34e6fe39b0f66e00c111b3f2b681' },
    { t:'TQQQB', address:'0x462b5f13b7c7748279358962925c5de83bb9e598' },
    { t:'QNTB', address:'0xd721c192d612db77621df57a9fab38418033c02e' },
    { t:'ORCLB', address:'0x4684d9887fc1c71cba7bab8e88835cec217eb598' },
    { t:'STXB', address:'0x2E065f65F1699964f4092De1D39A8EFe6C8d6f32' },
    { t:'CRWDB', address:'0x814981cf5df4a14d4d7328f9abf0d02e9ed54cd1' },
    { t:'SQQQB', address:'0x25e572b466d152604d9e6c3e53b432b978825342' },
    { t:'wTCENTx', address:'0x41333Df9E7639188BBfca5522dC4844398Af9f9E' },
    { t:'wPOPMTx', address:'0x4Ebf5Fd25B02022AfaD96E2fA25dA54A246FDEd0' },
    { t:'AMCB', address:'0x96e7d606e229448eF817A7f35fd7394C3E15d00C' },
    { t:'aWDH', address:'0x6458D4844ccaaD06dbf566D1df93D8815f89D9b0' },
    { t:'FXIon', address:'0x9b8E987e6fEc8Cf1380C4dcA7071e2C7853AEEA1' },
    { t:'BILIon', address:'0x91fc7371d6dE682A1e8CFcB4EB7dA693312A03a4' },
    { t:'SGOV', address:'0xc008c5F579ec1450F20099c39F587547e27c7523' },
  ],
  // Privy App ID from https://dashboard.privy.io (Settings -> App ID). Leave empty to use only browser wallets.
  // In the Privy dashboard, add your site domain (e.g. https://your-site.vercel.app) under allowed domains.
  privyAppId: "cmuswetv800kt0ciax1ih5op9",
  explorer: "https://bscscan.com",
  // In-platform launch through the Portal (newTokenV6). Values follow flap's developer docs and a working public launcher.
  launch: {
    portal: "0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0",
    standardImpl: "0x8b4329947e34b6d56d71a3385cac122bade7d78d",  // Standard Token Impl (TOKEN_V2_PERMIT) -> vanity suffix 8888
    suffix: "8888",
    tokenVersion:1,      // TOKEN_V2_PERMIT (standard, no tax)
    // Tax tokens (Tax Token V3, TOKEN_TAXED_V3) -> vanity suffix 7777. Values from flap's docs and a working public launcher.
    taxImpl: "0x024f18294970B5c76c0691b87f138A0317156422",
    taxSuffix: "7777",
    taxTokenVersion: 6,
    taxDurationSec: 31536000,     // tax stays on for 365 days
    antiFarmerSec: 3600,          // 1 hour anti-bot window at launch
    taxErc20Value: "1000000000",  // ~1 gwei of BNB required when a tax token uses an ERC-20 (stock) quote
    dividendMinShare: "10000",    // tokens a holder needs for dividends (only used if the creator picks dividends)
    dexThresh: 1,
    migratorType: 1,
    dexId: 0,
    lpFeeProfile: 0,
    uploadApi: "/api/upload",
    // Multi-pair (1 token, many pools) runs on PancakeSwap V2
    pcsRouter: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
    pcsFactory: "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73",
    multiSupply: "1000000000",
    // PancakeSwap V3 on BSC (addresses from pancakeswap/pancake-v3-contracts deployments/bscMainnet.json)
    pcsV3Factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
    pcsV3Npm: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
    pcsV3Router: "0x1b81D678ffb9C0263b24A97847620C99d213eB14",
    pcsV3Quoter: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997",
    v3Fee: 10000, v3Spacing: 200, v3Batch: 3,      // 1% pool fee tier (tick spacing 200), 3 pools per transaction
    multiStocks: ['SPCXB', 'SKHYB', 'NVDAB', 'QQQB', 'TSLAB', 'wPOPMTx', 'GOOGLB', 'GMEB', 'FXIon', 'BNCB', 'AAPLB', 'NFLXB'],   // stocks offered for multi-pair
    multiMaxPairs: 12,                             // max pools per multi-pair token (also enforced by the contract)
    multiHolderPct: 10,                            // default share of pool fees paid to holders (min 10%, enforced by the contract)
    multiMcapUsd: 5000,                            // default starting market cap for multi-pair tokens
    usdt: "0x55d398326f99059fF775485246999027B3197955",
    wbnb: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"
  },
};
