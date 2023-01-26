const { expect } = require('hardhat')
const { ethers, network } = require('hardhat')

const testHelpers = require('../utils/testHelpers.js')
const timeValues = testHelpers.TimeValues
const th = testHelpers.TestHelper
const toBN = th.toBN
const dec = th.dec
const ZERO_ADDRESS = th.ZERO_ADDRESS

const { abi: BOpABI } = require('../../artifacts/contracts/BorrowerOperations.sol/BorrowerOperations.json')
const { abi: ERC20ABI } = require('../../artifacts/@openzeppelin/contracts/token/ERC20/ERC20.sol/ERC20.json')

const BORROWER_OPERATIONS = '0x9eB2Ce1be2DD6947e4f5Aabe33106f48861DFD74'
const DFRANC_PARAMS = '0x6F9990B242873d7396511f2630412A3fcEcacc42'

const MULTISIG = '0x83737EAe72ba7597b36494D723fbF58cAfee8A69'

const LP_TOKEN_HOLDER = '0x005fb56Fe0401a4017e6f046272dA922BBf8dF06' // frax lpToken holder

const GV_FRAX = '0xF437C8cEa5Bb0d8C10Bb9c012fb4a765663942f1'
const CHAINLINK_USD_CHF = '0x449d117117838ffa61263b61da6301aa2a88b13a'
const ADMIN_CONTRACT = '0x2748C55219DCa1D9D3c3a57505e99BB04e42F254'
const OLD_PRICE_FEED = '0x09AB3C0ce6Cb41C13343879A667a6bDAd65ee9DA'

const CHAINLINK_ETHUSD = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
const CHAINLINK_BTCUSD = '0xf4030086522a5beea4988f8ca5b36dbc97bee88c'
const WBTC_ADDRESS = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'

const _chfFeed = '0x449d117117838ffa61263b61da6301aa2a88b13a'
const _feed = '0xB9E1E3A9feFf48998E45Fa90847ed4D467E8BcfD' // frax feed
const _usdcFeed = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'
const _daiFeed = '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9'
const _usdtFeed = '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D'
const _pool3Pool = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7'
const _gvToken = '0xF437C8cEa5Bb0d8C10Bb9c012fb4a765663942f1' // vault token
const _lpToken = '0xd632f22692FaC7611d2AA1C0D552930D43CAEd3B' // curvePool token
const _timeout = timeValues.SECONDS_IN_ONE_DAY

const deployParams = [
  _chfFeed,
  _usdcFeed,
  _daiFeed,
  _usdtFeed,
  _feed,
  _pool3Pool,
  _lpToken,
  _gvToken,
  _timeout
]

const ethParams = [_chfFeed, CHAINLINK_ETHUSD, _timeout]
const btcParams = [_chfFeed, CHAINLINK_BTCUSD, _timeout]

async function fundAccount(account, holder, lpTokenAddress) {
  await Promise.all([
    hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [holder],
    }),
    hre.network.provider.send('hardhat_setBalance', [holder, '0x33B2E3C9FD0803CE8000000']),
  ])

  const signer = await hre.ethers.getSigner(holder)
  const lpToken = new ethers.Contract(lpTokenAddress, ERC20ABI, signer)

  await lpToken.approve(holder, hre.ethers.utils.parseUnits('10000', 18))
  await lpToken.transferFrom(holder, account, hre.ethers.utils.parseUnits('10000', 18))
}

describe('Oracle', function () {
  let GVOracle
  let PriceFeed
  let ChainlinkOracleETH
  let ChainlinkOracleBTC
  let OldPriceFeedInstance

  beforeEach(async function () {
    ;[Owner, Account1, Account2, Account3, Account4] = await ethers.getSigners()

    const GVOracleFactory = await ethers.getContractFactory('ChainlinkPaired3PoolLpOracle')
    GVOracle = await GVOracleFactory.deploy(...deployParams)

    const ChainlinkOracleFactory = await ethers.getContractFactory('ChainlinkOracle')
    ChainlinkOracleETH = await ChainlinkOracleFactory.deploy(...ethParams)
    ChainlinkOracleBTC = await ChainlinkOracleFactory.deploy(...btcParams)

    const PriceFeedFactory = await ethers.getContractFactory('PriceFeed')
    PriceFeed = await PriceFeedFactory.deploy()
    await PriceFeed.setAddresses(ADMIN_CONTRACT)

    // new instance of the current mainnet deployed priceFeed to query and compare
    OldPriceFeedInstance = PriceFeedFactory.attach(OLD_PRICE_FEED)
  })

  describe('Add asset to price feed and fetch price', function () {
    it('Can add a new Chainlink3PoolPairedLpOracle asset and fetch the price', async function () {
      await PriceFeed.addOracle(_gvToken, GVOracle.address)

      const registeredOracle = await PriceFeed.registeredOracles(_gvToken)
      expect(registeredOracle).to.be.eq(GVOracle.address)

      const priceDirect = await PriceFeed.getDirectPrice(_gvToken)
      console.log('PriceDirect GVFrax3Crv in CHF:', priceDirect.toString())

      const priceFetch = await PriceFeed.callStatic.fetchPrice(_gvToken)
      console.log('PriceFetch GVFrax3Crv in CHF:', priceFetch.toString())

      expect(priceDirect.toString()).to.be.eq(priceFetch.toString())
    })

    it('Can add ETH as a new Chainlink asset and fetch the price', async function () {
      await PriceFeed.addOracle(ZERO_ADDRESS, ChainlinkOracleETH.address)

      const registeredOracle = await PriceFeed.registeredOracles(ZERO_ADDRESS)
      expect(registeredOracle).to.be.eq(ChainlinkOracleETH.address)

      const priceDirect = await PriceFeed.getDirectPrice(ZERO_ADDRESS)
      console.log('PriceDirect ETH in CHF:', priceDirect.toString())

      const priceFetch = await PriceFeed.callStatic.fetchPrice(ZERO_ADDRESS)
      console.log('PriceFetch ETH in CHF:', priceFetch.toString())

      expect(priceDirect.toString()).to.be.eq(priceFetch.toString())

      const priceOldFeed = await OldPriceFeedInstance.getDirectPrice(ZERO_ADDRESS)
      console.log('PriceDirect ETH in CHF mainnet PriceFeed:', priceOldFeed.toString())
      expect(priceDirect.toString()).to.be.eq(priceOldFeed.toString())
    })

    it('Can add BTC as a new Chainlink asset and fetch the price', async function () {
      await PriceFeed.addOracle(WBTC_ADDRESS, ChainlinkOracleBTC.address)

      const registeredOracle = await PriceFeed.registeredOracles(WBTC_ADDRESS)
      expect(registeredOracle).to.be.eq(ChainlinkOracleBTC.address)

      const priceDirect = await PriceFeed.getDirectPrice(WBTC_ADDRESS)
      console.log('PriceDirect ETH in CHF:', priceDirect.toString())

      const priceFetch = await PriceFeed.callStatic.fetchPrice(WBTC_ADDRESS)
      console.log('PriceFetch ETH in CHF:', priceFetch.toString())

      expect(priceDirect.toString()).to.be.eq(priceFetch.toString())

      const priceOldFeed = await OldPriceFeedInstance.getDirectPrice(WBTC_ADDRESS)
      console.log('PriceDirect BTC in CHF mainnet PriceFeed:', priceOldFeed.toString())
      expect(priceDirect.toString()).to.be.eq(priceOldFeed.toString())
    })

    it.skip('Can read getRoundData and latestRoundData', async function () {
      const getLatestRoundData = await GVOracle.latestAnswer()
      console.log('GetLatestRoundData lpOracle answer:', +getLatestRoundData.answer)
      console.log('GetLatestRoundData lpOracle timestamp:', +getLatestRoundData.updatedAt)

      expect(+getLatestRoundData.answer).to.be.greaterThan(0)
      expect(getLatestRoundData.updatedAt.toNumber()).to.be.greaterThan(1672531200) // 1-1-2023

      const blockNumBefore = await ethers.provider.getBlockNumber()
      const blockBefore = await ethers.provider.getBlock(blockNumBefore)
      const timestampBefore = blockBefore.timestamp
      const diff = timestampBefore - getLatestRoundData.updatedAt.toNumber()

      expect(diff).lt((await PriceFeed.TIMEOUT()).toNumber())
    })
  })

  describe('Gas testing of current and new PriceFeeds', function () {
    it('Opens a Trove with 4 accounts but different priceFeeds, gas reporting purposes', async function () {
      await PriceFeed.addOracle(ZERO_ADDRESS, ChainlinkOracleETH.address)

      // new instance of the current mainnet deployed BorrowerOperations
      const BorrowerOperationsFactory = await ethers.getContractFactory('BorrowerOperations')
      const BorrowerOperations = BorrowerOperationsFactory.attach(BORROWER_OPERATIONS)

      const minDebt = hre.ethers.utils.parseUnits('2500', 18)
      const coll = hre.ethers.utils.parseUnits('10', 18)

      const txI = await BorrowerOperations.connect(Account1).openTrove(
        ZERO_ADDRESS,
        0,
        th._100pct,
        minDebt,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        { value: coll }
      )
      const txIData = await txI.wait()
      console.log('gasUsed I old PriceFeed 1st openTrove:', txIData.cumulativeGasUsed.toNumber()) // 560559

      const txII = await BorrowerOperations.connect(Account2).openTrove(
        ZERO_ADDRESS,
        0,
        th._100pct,
        minDebt,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        { value: coll }
      )
      const txIIData = await txII.wait()
      console.log('gasUsed II old PriceFeed 2nd openTrove:', txIIData.cumulativeGasUsed.toNumber()) // 542855

      // new instance of the current mainnet deployed DfrancParameters
      const DfrancParametersFactory = await ethers.getContractFactory('DfrancParameters')
      const DfrancParams = DfrancParametersFactory.attach(DFRANC_PARAMS)

      await network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [MULTISIG],
      })
      const multiSig = ethers.provider.getUncheckedSigner(MULTISIG)

      // fund the multisig account to be able to process tx
      const forceETH = await ethers.getContractFactory('ForceETH')
      await forceETH.deploy(MULTISIG, { value: coll })

      // set the new priceFeed contract in dfrancParameters
      await DfrancParams.connect(multiSig).setPriceFeed(PriceFeed.address)

      const txIII = await BorrowerOperations.connect(Account3).openTrove(
        ZERO_ADDRESS,
        0,
        th._100pct,
        minDebt,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        { value: coll }
      )
      const txIIIData = await txIII.wait()
      console.log('gasUsed III new PriceFeed 1st openTrove:', txIIIData.cumulativeGasUsed.toNumber()) // 508591

      const txIV = await BorrowerOperations.connect(Account4).openTrove(
        ZERO_ADDRESS,
        0,
        th._100pct,
        minDebt,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        { value: coll }
      )
      const txIVData = await txIV.wait()
      console.log('gasUsed IV new PriceFeed 2nd openTrove:', txIVData.cumulativeGasUsed.toNumber()) // 508591
    })

    it('Opens new Troves with new asset and new priceFeed, gas reporting purposes', async function () {
      await PriceFeed.addOracle(_lpToken, ChainlinkOracleETH.address)

      // new instance of the current mainnet deployed BorrowerOperations
      const BorrowerOperationsFactory = await ethers.getContractFactory('BorrowerOperations')
      const BorrowerOperations = BorrowerOperationsFactory.attach(BORROWER_OPERATIONS)

      // new instance of the current mainnet deployed DfrancParameters
      const DfrancParametersFactory = await ethers.getContractFactory('DfrancParameters')
      const DfrancParams = DfrancParametersFactory.attach(DFRANC_PARAMS)

      await network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [MULTISIG],
      })
      const multiSig = ethers.provider.getUncheckedSigner(MULTISIG)

      // fund the multisig account to be able to process tx
      const forceETH = await ethers.getContractFactory('ForceETH')
      await forceETH.deploy(MULTISIG, { value: hre.ethers.utils.parseUnits('10', 18) })

      // set the new priceFeed contract in dfrancParameters
      await DfrancParams.connect(multiSig).setPriceFeed(PriceFeed.address)
      // we add the new asset by setting as default in dfrancParameters
      await DfrancParams.connect(multiSig).setAsDefault(_lpToken)

      const amount = hre.ethers.utils.parseUnits('10000', 18)
      const minDebt = hre.ethers.utils.parseUnits('2500', 18)

      // new instance of the current mainnet deployed curve lpToken
      const lpTokenFactory = await ethers.getContractFactory('ERC20')
      const lpToken = lpTokenFactory.attach(_lpToken)

      // fund with lpTokens account1
      await fundAccount(Account1.address, LP_TOKEN_HOLDER, _lpToken)

      // allow the borrower operations as spender
      await lpToken.connect(Account1).approve(BorrowerOperations.address, amount)

      const txI = await BorrowerOperations.connect(Account1).openTrove(
        _lpToken,
        amount,
        th._100pct,
        minDebt,
        ZERO_ADDRESS,
        ZERO_ADDRESS
      )
      const txIData = await txI.wait()
      console.log('gasUsed I new PriceFeed lpToken 1st openTrove:', txIData.cumulativeGasUsed.toNumber()) // 694456

      // fund with lpTokens account2
      await fundAccount(Account2.address, LP_TOKEN_HOLDER, _lpToken)

      // allow the borrower operations as spender
      await lpToken.connect(Account2).approve(BorrowerOperations.address, amount)

      const txII = await BorrowerOperations.connect(Account2).openTrove(
        _lpToken,
        amount,
        th._100pct,
        minDebt,
        ZERO_ADDRESS,
        ZERO_ADDRESS
      )
      const txIIData = await txII.wait()
      console.log('gasUsed II new PriceFeed lpToken 2nd openTrove:', txIIData.cumulativeGasUsed.toNumber()) // 521359

      // fund with lpTokens account3
      await fundAccount(Account3.address, LP_TOKEN_HOLDER, _lpToken)

      // allow the borrower operations as spender
      await lpToken.connect(Account3).approve(BorrowerOperations.address, amount)
      const txIII = await BorrowerOperations.connect(Account3).openTrove(
        _lpToken,
        amount,
        th._100pct,
        minDebt,
        ZERO_ADDRESS,
        ZERO_ADDRESS
      )
      const txIIIData = await txIII.wait()
      console.log('gasUsed III new PriceFeed lpToken 3rd openTrove:', txIIIData.cumulativeGasUsed.toNumber()) // 521359
    })
  })

  describe('Getters from LpOracle', function () {
    it.skip('Returns correctly the decimals', async function () {
      const decimals = await GVOracle.decimals()
      expect(decimals).to.equal(18)
    })
    it.skip('Returns correctly the decimals adjustment var', async function () {
      const decimalsAdjustment = await GVOracle.DECIMAL_ADJUSTMENT()
      expect(decimalsAdjustment.toString()).to.be.deep.equal(dec(1, 26))
    })
  })

  describe('Getters from PriceFeed', function () {
    it.skip('AdminContract is the owner', async function () {
      const adminContract = await PriceFeed.adminContract()
      expect(ADMIN_CONTRACT).to.eq(adminContract)
    })
  })
})
