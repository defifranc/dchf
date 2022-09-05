const { TestHelper: th, TimeValues: timeVals } = require("../helpers/testHelpers.js")
const { dec } = th

const DeploymentHelper = require("../helpers/deploymentHelpers.js")
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants")
const { ethers } = require("hardhat")
const toBN = ethers.BigNumber.from


let mdh;
let config;
let deployerWallet;
let gasPrice;
let vestaCore;
let MONContracts;
let deploymentState;

let ADMIN_WALLET
let TREASURY_WALLET

async function mainnetDeploy(configParams) {
  console.log(new Date().toUTCString())

  config = configParams;
  gasPrice = config.GAS_PRICE;

  ADMIN_WALLET = config.dfrancAddresses.ADMIN_MULTI
  TREASURY_WALLET = config.dfrancAddresses.MON_SAFE

  deployerWallet = (await ethers.getSigners())[0]
  mdh = new DeploymentHelper(config, deployerWallet)

  deploymentState = mdh.loadPreviousDeployment()

  console.log(`deployer address: ${deployerWallet.address}`)
  assert.equal(deployerWallet.address, config.dfrancAddresses.DEPLOYER)

  console.log(`deployerETHBalance before: ${await ethers.provider.getBalance(deployerWallet.address)}`)

  // Deployment Phase 1
  if (config.DEPLOYMENT_PHASE == 1) {
    console.log("Only Deploy MON token");

    const MONToken = await mdh.deployMONToken(TREASURY_WALLET, deploymentState);

    mdh.saveDeployment(deploymentState)

    console.log(`deployerETHBalance after: ${await ethers.provider.getBalance(deployerWallet.address)}`)

    return;
  }

  // Deployment Phase 2
  if (config.DEPLOYMENT_PHASE == 2) {
    console.log("Deploy MON token if not deployed and LockMON");

    const partialContracts = await mdh.deployPartially(TREASURY_WALLET, deploymentState);

    // create vesting rule to beneficiaries
    console.log("Beneficiaries")

    if ((await partialContracts.MONToken.allowance(deployerWallet.address, partialContracts.lockedMON.address)) == 0)
      await (await partialContracts.MONToken.approve(partialContracts.lockedMON.address, ethers.constants.MaxUint256)).wait();

    const beneficiaries = Object.entries(config.beneficiaries);

    const batchSize = config.MON_LOCK_BATCH_SIZE;

    for (let i = 0; i < beneficiaries.length; i += batchSize) {

      const currentBatchObj = beneficiaries.slice(i, i + batchSize);

      const wallets = [];
      const amounts = [];

      for (const [key, value] of currentBatchObj) {
        wallets.push(key);
        amounts.push(dec(value, 18));
      }

      const txReceipt = await mdh.sendAndWaitForTransaction(partialContracts.lockedMON.addEntityVestingBatch(wallets, amounts));

      for (let i = 0; i < amounts.length; i++) {
        deploymentState[wallets[i]] = {
          amount: amounts[i],
          txHash: txReceipt.transactionHash
        }

        mdh.saveDeployment(deploymentState)
      }

    }

    await transferOwnership(partialContracts.lockedMON, TREASURY_WALLET);

    console.log(`deployerETHBalance after: ${await ethers.provider.getBalance(deployerWallet.address)}`)

    return;

  }

  // Deployment Phase 3
  if (config.DEPLOYMENT_PHASE == 3) {
    // Deploy core logic contracts
    vestaCore = await mdh.deployLiquityCoreMainnet(deploymentState, ADMIN_WALLET)

    await mdh.logContractObjects(vestaCore)

    // Deploy MON Contracts
    MONContracts = await mdh.deployMONContractsMainnet(
      TREASURY_WALLET, // multisig MON endowment address
      deploymentState,
    )

    // Connect all core contracts up
    console.log("Connect Core Contracts up");


    await mdh.connectCoreContractsMainnet(
      vestaCore,
      MONContracts
    )

    console.log("Connect MON Contract to Core");
    await mdh.connectMONContractsToCoreMainnet(MONContracts, vestaCore, TREASURY_WALLET)


    console.log("Adding Collaterals");
    const allowance = (await MONContracts.MONToken.allowance(deployerWallet.address, MONContracts.communityIssuance.address));
    if (allowance == 0)
      await MONContracts.MONToken.approve(MONContracts.communityIssuance.address, ethers.constants.MaxUint256)


    await addETHCollaterals();
    await addBTCCollaterals();

    mdh.saveDeployment(deploymentState)

    await mdh.deployMultiTroveGetterMainnet(vestaCore, deploymentState)
    await mdh.logContractObjects(MONContracts)

    await giveContractsOwnerships();
  }

}

async function addETHCollaterals() {

  const ETHAddress = !config.IsMainnet
    ? await mdh.deployMockERC20Contract(deploymentState, "mockETH", 18)
    : config.externalAddrs.WETH_ERC20

  if (!ETHAddress || ETHAddress == "")
    throw ("CANNOT FIND THE ETH Address")

  if ((await vestaCore.stabilityPoolManager.unsafeGetAssetStabilityPool(ETHAddress)) == ZERO_ADDRESS) {

    console.log("Creating Collateral - ETH")

    const stabilityPoolETHProxy = await upgrades.deployProxy(await mdh.getFactory("StabilityPool"), [
      ETHAddress,
      vestaCore.borrowerOperations.address,
      vestaCore.troveManager.address,
      vestaCore.troveManagerHelpers.address,
      vestaCore.dchfToken.address,
      vestaCore.sortedTroves.address,
      MONContracts.communityIssuance.address,
      vestaCore.dfrancParameters.address
    ], { initializer: 'setAddresses' });

    await stabilityPoolETHProxy.deployed();

    const txReceiptProxyETH = await mdh
      .sendAndWaitForTransaction(
        vestaCore.adminContract.addNewCollateral(
          stabilityPoolETHProxy.address,
          config.externalAddrs.CHAINLINK_ETHUSD_PROXY,
          config.externalAddrs.CHAINLINK_USDCHF_PROXY,
          dec(config.monetaCommunityIssuanceParams.ETH_STABILITY_POOL_FUNDING, 18),
          dec(config.monetaCommunityIssuanceParams.ETH_STABILITY_POOL_WEEKLY_DISTRIBUTION, 18),
          config.REDEMPTION_SAFETY), {
        gasPrice,
      })


    const name = "ProxyStabilityPoolETH";

    deploymentState[name] = {
      address: await vestaCore.stabilityPoolManager.getAssetStabilityPool(ETHAddress),
      txHash: txReceiptProxyETH.transactionHash
    }

    await mdh.verifyContract(name, deploymentState, [], true);
  }
}

async function addBTCCollaterals() {
  const BTCAddress = !config.IsMainnet
    ? await mdh.deployMockERC20Contract(deploymentState, "renBTC", 8)
    : config.externalAddrs.REN_BTC

  if (!BTCAddress || BTCAddress == "")
    throw ("CANNOT FIND THE renBTC Address")

  if ((await vestaCore.stabilityPoolManager.unsafeGetAssetStabilityPool(BTCAddress)) == ZERO_ADDRESS) {
    console.log("Creating Collateral - BTC")

    const stabilityPoolBTCProxy = await upgrades.deployProxy(await mdh.getFactory("StabilityPool"), [
      BTCAddress,
      vestaCore.borrowerOperations.address,
      vestaCore.troveManager.address,
      vestaCore.troveManagerHelpers.address,
      vestaCore.dchfToken.address,
      vestaCore.sortedTroves.address,
      MONContracts.communityIssuance.address,
      vestaCore.dfrancParameters.address
    ], { initializer: 'setAddresses' });


    await stabilityPoolBTCProxy.deployed();

    const txReceiptProxyBTC = await mdh
      .sendAndWaitForTransaction(
        vestaCore.adminContract.addNewCollateral(
          stabilityPoolBTCProxy.address,
          config.externalAddrs.CHAINLINK_BTCUSD_PROXY,
          config.externalAddrs.CHAINLINK_USDCHF_PROXY,
          dec(config.monetaCommunityIssuanceParams.BTC_STABILITY_POOL_FUNDING, 18),
          dec(config.monetaCommunityIssuanceParams.BTC_STABILITY_POOL_WEEKLY_DISTRIBUTION, 18),
          config.REDEMPTION_SAFETY), {
        gasPrice,
      });

    const name = "ProxyStabilityPoolRenBTC";

    deploymentState[name] = {
      address: await vestaCore.stabilityPoolManager.getAssetStabilityPool(BTCAddress),
      txHash: txReceiptProxyBTC.transactionHash
    }

    await mdh.verifyContract(name, deploymentState, [], true);
  }
}


async function giveContractsOwnerships() {
  await transferOwnership(vestaCore.adminContract, ADMIN_WALLET);
  await transferOwnership(vestaCore.priceFeed, ADMIN_WALLET);
  await transferOwnership(vestaCore.dfrancParameters, ADMIN_WALLET);
  await transferOwnership(vestaCore.stabilityPoolManager, ADMIN_WALLET);
  await transferOwnership(vestaCore.dchfToken, ADMIN_WALLET);
  await transferOwnership(MONContracts.MONStaking, ADMIN_WALLET);

  await transferOwnership(vestaCore.lockedMON, TREASURY_WALLET);
  await transferOwnership(MONContracts.communityIssuance, TREASURY_WALLET);
}

async function transferOwnership(contract, newOwner) {

  console.log("Transfering Ownership of", contract.address)

  if (!newOwner)
    throw "Transfering ownership to null address";

  if (await contract.owner() != newOwner)
    await contract.transferOwnership(newOwner)

  console.log("Transfered Ownership of", contract.address)

}

module.exports = {
  mainnetDeploy
}
