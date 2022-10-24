import { s } from "../scope";
import { d } from "../DeploymentInfo";
import { showBody, showBodyCyan } from "../../../util/format";
import { upgrades, ethers } from "hardhat";

import { BN } from "../../../util/number";
import { advanceBlockHeight, nextBlockTime, fastForward, mineBlock, OneWeek, OneYear } from "../../../util/block";
import { utils, BigNumber } from "ethers";
import { calculateAccountLiability, payInterestMath, calculateBalance, getGas, getArgs, truncate, getEvent, calculatetokensToLiquidate, calculateUSDA2repurchase, changeInBalance } from "../../../util/math";
import { currentBlock, reset } from "../../../util/block"
import MerkleTree from "merkletreejs";
import { keccak256, solidityKeccak256 } from "ethers/lib/utils";
import { expect, assert } from "chai";
import { toNumber } from "../../../util/math"
import {
  AnchoredViewV2__factory,
  IVault__factory,
  CappedFeeOnTransferToken__factory,
  ChainlinkOracleRelay__factory,
  UniswapV2OracleRelay__factory,
  VotingVault__factory,
  VotingVaultController__factory
} from "../../../typechain-types"
import { red } from "bn.js";
import { DeployContract, DeployContractWithProxy } from "../../../util/deploy";
import { ceaseImpersonation, impersonateAccount } from "../../../util/impersonator";
import { stealMoney } from "../../../util/money";

require("chai").should();
describe("Check Interest Protocol contracts", () => {
  describe("Sanity check USDa deploy", () => {
    it("Should return the right name, symbol, and decimals", async () => {

      expect(await s.USDA.name()).to.equal("USDA Token");
      expect(await s.USDA.symbol()).to.equal("USDA");
      expect(await s.USDA.decimals()).to.equal(18);
      //expect(await s.USDA.owner()).to.equal(s.Frank.address);
      //s.owner = await s.USDA.owner()
      s.pauser = await s.USDA.pauser()
    });
  });

  describe("Sanity check VaultController deploy", () => {
    it("Check data on VaultControler", async () => {
      let tokensRegistered = await s.VaultController.tokensRegistered()
      expect(tokensRegistered).to.be.gt(0)
      let interestFactor = await s.VaultController.interestFactor()
      expect(await toNumber(interestFactor)).to.be.gt(1)

    });
  });
});



describe("Deploy CappedPAXG contract and infastructure", () => {

  const ethAmount = BN("1e18")
  let tx = {
    to: s.owner._address,
    value: ethAmount
  }
  before(async () => {
    await s.Frank.sendTransaction(tx)
    await mineBlock()
  })

  it("Deploy CappedPAXG", async () => {
    s.CappedPAXG = await DeployContractWithProxy(
      new CappedFeeOnTransferToken__factory(s.Frank),
      s.Frank,
      s.ProxyAdmin,
      "CappedPAXG",
      "cpPAXG",
      s.PAXG_ADDR,
      d.VaultController,
      s.VotingVaultController.address
    )
    await mineBlock();
    await s.CappedPAXG.deployed()

  })

  it("Set Cap", async () => {
    await s.CappedPAXG.connect(s.Frank).setCap(s.PAXG_CAP)
    await mineBlock()
  })

  it("Sanity check", async () => {
    expect(await s.CappedPAXG.getCap()).to.eq(s.PAXG_CAP)
    expect(await s.CappedPAXG._underlying()).to.eq(s.PAXG.address)
  })
})

describe("Deploy and stup oracle system", () => {
  const owner = ethers.provider.getSigner(s.IP_OWNER)
  const ethAmount = BN("1e18")
  let tx = {
    to: owner._address,
    value: ethAmount
  }

  before(async () => {
    await s.Frank.sendTransaction(tx)
    await mineBlock()
  })
  it("Deploy oracle system for PAXG", async () => {

    const v2PaxgPool = "0x9C4Fe5FFD9A9fC5678cFBd93Aa2D4FD684b67C4C"
    s.UniV2Relay = await DeployContract(
      new UniswapV2OracleRelay__factory(s.Frank),
      s.Frank,
      v2PaxgPool,
      s.PAXG_ADDR,
      BN("1"),
      BN("1")
    )
    await mineBlock()
    await mineBlock()
    const result = await s.UniV2Relay.update()
    await mineBlock()
    await fastForward(500)
    await mineBlock()
    await s.UniV2Relay.update()
    await mineBlock()
    const gas = await getGas(result)
    showBodyCyan("Gas cost to update: ", gas)

    let amountOut = await s.UniV2Relay.currentValue()
    //showBody("amountOut: ", await toNumber(amountOut))

    const CL_feed = "0x9b97304ea12efed0fad976fbecaad46016bf269e"
    const LinkRelay = await DeployContract(
      new ChainlinkOracleRelay__factory(s.Frank),
      s.Frank,
      CL_feed,
      BN("1"),
      BN("1")
    )
    await mineBlock()
    let linkPrice = await LinkRelay.currentValue()
    //showBody("Link price: ", await toNumber(linkPrice))

    const anchorView = await DeployContract(
      new AnchoredViewV2__factory(s.Frank),
      s.Frank,
      s.UniV2Relay.address,
      LinkRelay.address,
      BN("10"),
      BN("100")
    )
    await mineBlock()
    let anchorPrice = await anchorView.currentValue()
    //showBody(await toNumber(anchorPrice))

    await impersonateAccount(owner._address)
    await s.Oracle.connect(owner).setRelay(s.CappedPAXG.address, anchorView.address)
    await mineBlock()
    await ceaseImpersonation(owner._address)

    let price = await s.Oracle.getLivePrice(s.CappedPAXG.address)
    expect(price).to.not.eq(0, "Getting a price")



  })

  it("Register capped token on VaultController", async () => {
    await impersonateAccount(owner._address)

    await s.VaultController.connect(owner).registerErc20(
      s.CappedPAXG.address,
      s.UNI_LTV,
      s.CappedPAXG.address,
      s.LiquidationIncentive
    )
    await mineBlock()

    await ceaseImpersonation(owner._address)

  })

  it("Register Underlying on voting vault controller", async () => {

    await impersonateAccount(s.owner._address)

    await s.VotingVaultController.connect(s.owner).registerUnderlying(s.PAXG.address, s.CappedPAXG.address)
    await mineBlock()
    await ceaseImpersonation(s.owner._address)

    //await s.VotingVaultController.connect(s.Frank).registerUnderlying(s.PAXG.address, s.CappedPAXG.address)
    //await mineBlock()

    const _underlying_CappedToken = await s.VotingVaultController._underlying_CappedToken(s.PAXG_ADDR)
    const _CappedToken_underlying = await s.VotingVaultController._CappedToken_underlying(s.CappedPAXG.address)

    expect(_underlying_CappedToken.toUpperCase()).to.eq(s.CappedPAXG.address.toUpperCase(), "Capped token registered correctly")
    expect(_CappedToken_underlying.toUpperCase()).to.eq(s.PAXG.address.toUpperCase(), "Underlying token registered correctly")

  })

  it("Mint vault from vault controller", async () => {
    //showBody("bob mint vault")
    await expect(s.VaultController.connect(s.Bob).mintVault()).to.not
      .reverted;
    await mineBlock();
    s.BobVaultID = await s.VaultController.vaultsMinted()
    let vaultAddress = await s.VaultController.vaultAddress(s.BobVaultID)
    s.BobVault = IVault__factory.connect(vaultAddress, s.Bob);
    expect(await s.BobVault.minter()).to.eq(s.Bob.address);

    //showBody("carol mint vault")
    await expect(s.VaultController.connect(s.Carol).mintVault()).to.not
      .reverted;
    await mineBlock();
    s.CaroLVaultID = await s.VaultController.vaultsMinted()
    vaultAddress = await s.VaultController.vaultAddress(s.CaroLVaultID)
    s.CarolVault = IVault__factory.connect(vaultAddress, s.Carol);
    expect(await s.CarolVault.minter()).to.eq(s.Carol.address);
  })

  it("Mint voting vault", async () => {

    let _vaultId_votingVaultAddress = await s.VotingVaultController._vaultId_votingVaultAddress(s.BobVaultID)
    expect(_vaultId_votingVaultAddress).to.eq("0x0000000000000000000000000000000000000000", "Voting vault not yet minted")

    const result = await s.VotingVaultController.connect(s.Bob).mintVault(s.BobVaultID)
    await mineBlock()

    let vaultAddr = await s.VotingVaultController._vaultId_votingVaultAddress(s.BobVaultID)
    s.BobVotingVault = VotingVault__factory.connect(vaultAddr, s.Bob)

    expect(s.BobVotingVault.address.toString().toUpperCase()).to.eq(vaultAddr.toString().toUpperCase(), "Bob's voting vault setup complete")
  })
})

describe("Check oracle", () => {
  const Router02Address = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"
  const IUniswapV2Router02 = require("../../isolated/uniPool/util/IUniswapV2Router02")
  const router02ABI = new IUniswapV2Router02()
  let ro2 = router02ABI.Router02()
  const router02 = ro2[0].abi
  const routerV2 = new ethers.Contract(Router02Address, router02, ethers.provider)

  let largePAXGamount: BigNumber

  before(async () => {
    largePAXGamount = BN("250e18")//await s.PAXG.balanceOf(s.PAXG_WHALE)
    //showBody("LARGE PAXG AMOUNT: ", await toNumber(largePAXGamount))
    //fund Gus with a large amount of PAXG to do a swap
    await stealMoney(s.PAXG_WHALE, s.Gus.address, s.PAXG_ADDR, largePAXGamount)
    await mineBlock()
  })

  it("Check oracle", async () => {
    const price = await s.Oracle.getLivePrice(s.CappedPAXG.address)
    expect(await toNumber(price)).to.be.closeTo(1700, 100, "Price is correct")
  })


  it("Do a big swap on uniswap to change the price", async () => {

    const startBalance = await s.PAXG.balanceOf(s.Gus.address)
    expect(startBalance).to.be.gt(largePAXGamount)

    //approve
    await s.PAXG.connect(s.Gus).approve(routerV2.address, largePAXGamount)
    await mineBlock()
    //showBody("Gus PAXG: ", await toNumber(await s.PAXG.balanceOf(s.Gus.address)))
    //showBody("large PAXG: ", await toNumber(largePAXGamount))

    const block = await currentBlock()
    const deadline = block.timestamp + 500

    //swap exact tokens for tokens
    await routerV2.connect(s.Gus).swapExactTokensForTokensSupportingFeeOnTransferTokens(
      largePAXGamount,
      0,//amountOutMin - PAXG is worth slightly less than ETH
      [s.PAXG.address, s.WETH.address],
      s.Gus.address,
      deadline
    )
    await mineBlock()

    let balance = await s.PAXG.balanceOf(s.Gus.address)
    expect(await toNumber(balance)).to.be.closeTo(await toNumber(startBalance.sub(largePAXGamount)), 0.0021, "Correct amount of PAXG deducted from Gus")
    //expect(balance).to.eq(0, "All PAXG spent")

  })

  it(`Selling 250 PAXG is not enough to move the price on the anchor by the buffer amount`, async () => {

    const startPrice = await s.UniV2Relay.currentValue()

    const oraclePrice = await s.Oracle.getLivePrice(s.CappedPAXG.address)
    expect(oraclePrice).to.be.gt(0, "Valid oracle price returned")

    await fastForward(OneWeek)
    await mineBlock()
    await s.UniV2Relay.update()
    await mineBlock()

    let newEthPrice = await s.UniV2Relay.currentValue()
    expect(await toNumber(newEthPrice)).to.be.gt(await toNumber(startPrice) * 0.9, "Price is still in the expected bounds, update was not needed")

    const percentMoved = (1 - (await toNumber(newEthPrice) / await toNumber(startPrice))) * 100
    expect(percentMoved).to.be.lt(10, `Selling ${await toNumber(largePAXGamount)} PAXG moved the price by less than 10%, no need to call update`)

  })
})