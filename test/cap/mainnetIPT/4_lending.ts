import { s } from "../scope";
import { d } from "../DeploymentInfo";
import { showBody, showBodyCyan } from "../../../util/format";
import { BN } from "../../../util/number";
import { advanceBlockHeight, nextBlockTime, fastForward, mineBlock, OneWeek, OneYear, OneDay } from "../../../util/block";
import { utils, BigNumber } from "ethers";
import { calculateAccountLiability, payInterestMath, calculateBalance, getGas, getArgs, truncate, getEvent, calculatetokensToLiquidate, calculateUSDA2repurchase, changeInBalance } from "../../../util/math";
import { currentBlock, reset } from "../../../util/block"
import MerkleTree from "merkletreejs";
import { keccak256, solidityKeccak256 } from "ethers/lib/utils";
import { expect, assert } from "chai";
import { toNumber } from "../../../util/math"
import { red } from "bn.js";
import { DeployContract, DeployContractWithProxy } from "../../../util/deploy";
import { start } from "repl";
import { VotingVault__factory } from "../../../typechain-types";
require("chai").should();

const borrowAmount = BN("25e18")


describe("Check starting values", () => {
    const amount = BN("500e18")
    it("Check starting balance", async () => {
        const startCap = await s.cIPT.balanceOf(s.BobVault.address)
        expect(startCap).to.eq(amount, "Starting balance is correct")

        let balance = await s.WBTC.balanceOf(s.BobVault.address)
        expect(balance).to.eq(0, "Bob's vault holds 0")

        balance = await s.WETH.balanceOf(s.BobVault.address)
        expect(balance).to.eq(0, "Bob's vault holds 0")

        balance = await s.UNI.balanceOf(s.BobVault.address)
        expect(balance).to.eq(0, "Bob's vault holds 0")
        let liability = await s.VaultController.vaultLiability(s.BobVaultID)
        expect(liability).to.eq(0, "Bob's vault has no outstanding debt")
    })

    it("Check borrow power / LTV", async () => {
        let borrowPower = await s.VaultController.vaultBorrowingPower(s.BobVaultID)
        expect(borrowPower).to.be.gt(0, "There exists a borrow power against capped token")

        const balance = await s.cIPT.balanceOf(s.BobVault.address)
        const price = await s.Oracle.getLivePrice(s.cIPT.address)
        let totalValue = (balance.mul(price)).div(BN("1e18"))
        let expectedBorrowPower = (totalValue.mul(s.UNI_LTV)).div(BN("1e18"))

        expect(await toNumber(borrowPower)).to.be.closeTo(await toNumber(expectedBorrowPower), 0.0001, "Borrow power is correct")
    })
})

describe("Lending with mainnet IPT", () => {
    it("Borrow a small amount against capped token", async () => {

        const startUSDA = await s.USDA.balanceOf(s.Bob.address)
        expect(startUSDA).to.eq(0, "Bob holds 0 USDa")

        await s.VaultController.connect(s.Bob).borrowUsdi(s.BobVaultID, borrowAmount)
        await mineBlock()

        await s.VaultController.connect(s.Bob).borrowUsdi(s.BobVaultID, borrowAmount)
        await mineBlock()

        let balance = await s.USDA.balanceOf(s.Bob.address)
        expect(await toNumber(balance)).to.be.closeTo(await toNumber(startUSDA.add(borrowAmount.mul(2))), 0.001, "Bob received USDa loan")

    })

    it("Check loan details", async () => {

        const liability = await s.VaultController.vaultLiability(s.BobVaultID)
        expect(await toNumber(liability)).to.be.closeTo(await toNumber(borrowAmount.mul(2)), 0.001, "Liability is correct")

    })

    it("Repay loan", async () => {
        expect(await s.USDC.balanceOf(s.Bob.address)).to.eq(s.Bob_USDC, "Bob still holds starting USDC")

        //deposit some to be able to repay all
        await s.USDC.connect(s.Bob).approve(s.USDA.address, BN("50e6"))
        await s.USDA.connect(s.Bob).deposit(BN("50e6"))
        await mineBlock()

        await s.USDA.connect(s.Bob).approve(s.VaultController.address, await s.USDA.balanceOf(s.Bob.address))
        await s.VaultController.connect(s.Bob).repayAllUSDa(s.BobVaultID)
        //await mineBlock()
        //await mineBlock()
        await advanceBlockHeight(1)
        await fastForward(OneDay)


        const liability = await s.VaultController.vaultLiability(s.BobVaultID)
        expect(liability).to.eq(0, "Loan repaid")
    })
})

    /**
     it("Check governance vote delegation", async () => {
        const startPower = await s.IPT.getPowerCurrent(s.Bob.address, 0)

        //Unable to delegate gov tokens in a vault that you don't own
        expect(s.BobVotingVault.connect(s.Carol).delegateCompLikeTo(s.Bob.address, s.IPT.address)).to.be.revertedWith("sender not minter")

        //delegate
        await s.BobVotingVault.connect(s.Bob).delegateCompLikeTo(s.Bob.address, s.IPT.address)
        await mineBlock()

        let power = await s.IPT.getPowerCurrent(s.Bob.address, 0)

        const expected = (await s.IPT.balanceOf(s.Bob.address)).add(await s.IPT.balanceOf(s.BobVotingVault.address))

        expect(power).to.be.gt(startPower, "Voting power increased")
        expect(power).to.eq(expected, "Expected voting power achieved")

    })
     */

    /**
     * Bob minted this voting vault using Carol's regular vault ID
     * Previous tests confirmed Carol is the minter
     * We will now confirm that only carol has the right to delegate voting power
     */
    /**
     it("Check governance vote delgation for a vault that was minted by someone else", async () => {
        const amount = BN("50e18")

        //raise cap so Carol can have some capped IPT
        await s.cIPT.connect(s.Frank).setCap(BN("550e18"))
        await mineBlock()

        //Bob funds Carol's vault
        await s.IPT.connect(s.Bob).approve(s.cIPT.address, amount)
        await s.cIPT.connect(s.Bob).deposit(amount, s.CaroLVaultID)
        await mineBlock()

        const startPower = await s.IPT.getPowerCurrent(s.Carol.address, 0)
        expect(startPower).to.eq(0, "Carol holds 0 IPT and has no delegated voting power")

        await s.CarolVotingVault.connect(s.Carol).delegateCompLikeTo(s.Carol.address, s.IPT.address)
        await mineBlock()

        let power = await s.IPT.getPowerCurrent(s.Carol.address, 0)
        expect(power).to.eq(amount, "Voting power is correct")

        await s.CarolVault.connect(s.Carol).withdrawErc20(s.cIPT.address, amount)
        await s.IPT.connect(s.Carol).transfer(s.Bob.address, amount)
        await mineBlock()

    })
     */
/** 
    
*/


describe("Liquidations", () => {

    let borrowPower: BigNumber
    let T2L: BigNumber

    before(async () => {
        borrowPower = await s.VaultController.vaultBorrowingPower(s.BobVaultID)
    })

   
     
    it("Borrow max", async () => {

        const startUSDA = await s.USDA.balanceOf(s.Bob.address)

        let startLiab = await s.VaultController.vaultLiability(s.BobVaultID)
        expect(startLiab).to.eq(0, "Liability is still 0")

        await s.VaultController.connect(s.Bob).borrowUsdi(s.BobVaultID, borrowPower)
        await mineBlock()
        const liab = await s.VaultController.vaultLiability(s.BobVaultID)
        expect(await toNumber(liab)).to.be.closeTo(await toNumber(borrowPower), 0.001, "Liability is correct")

        let balance = await s.USDA.balanceOf(s.Bob.address)
        expect(await toNumber(balance)).to.be.closeTo(await toNumber(borrowPower.add(startUSDA)), 0.1, "Balance is correct")

    })

    it("Elapse time to put vault underwater", async () => {

        await fastForward(OneYear)
        await mineBlock()
        await s.VaultController.calculateInterest()
        await mineBlock()

        const solvency = await s.VaultController.checkVault(s.BobVaultID)
        expect(solvency).to.eq(false, "Bob's vault is now underwater")

    })

    it("Try to withdraw when vault is underwater", async () => {
        const amount = BN("250e18")
        expect(s.BobVault.connect(s.Bob).withdrawErc20(s.cIPT.address, amount)).to.be.revertedWith("over-withdrawal")
    })

    it("Liquidate", async () => {

        const amountToSolvency = await s.VaultController.amountToSolvency(s.BobVaultID)
        expect(amountToSolvency).to.be.gt(0, "Vault underwater")

        const tokensToLiquidate = await s.VaultController.tokensToLiquidate(s.BobVaultID, s.cIPT.address)
        T2L = tokensToLiquidate
        expect(tokensToLiquidate).to.be.gt(0, "Capped Tokens are liquidatable")

        const price = await s.Oracle.getLivePrice(s.cIPT.address)
        expect(price).to.be.gt(0, "Valid price")

        const liquidationValue = (price.mul(tokensToLiquidate)).div(BN("1e18"))

        const startSupply = await s.cIPT.totalSupply()
        //expect(startSupply).to.eq(borrowAmount.mul(2).add(69), "Starting supply unchanged")

        await s.USDC.connect(s.Dave).approve(s.USDA.address, await s.USDC.balanceOf(s.Dave.address))
        await s.USDA.connect(s.Dave).deposit(await s.USDC.balanceOf(s.Dave.address))
        await mineBlock()
      
        const startingUSDA = await s.USDA.balanceOf(s.Dave.address)
        expect(startingUSDA).to.eq(s.Dave_USDC.mul(BN("1e12")))

        const startingCIPT = await s.cIPT.balanceOf(s.BobVault.address)
        const startIPT = await s.IPT.balanceOf(s.Dave.address)
        expect(startIPT).to.eq(0, "Dave holds 0 IPT")

        const result = await s.VaultController.connect(s.Dave).liquidateVault(s.BobVaultID, s.cIPT.address, BN("1e50"))
        await mineBlock()

        let supply = await s.cIPT.totalSupply()

        expect(await toNumber(supply)).to.be.closeTo(await toNumber(startSupply.sub(tokensToLiquidate)), 2, "Total supply reduced as Capped IPT is liquidated")


        let endCIPT = await s.cIPT.balanceOf(s.BobVault.address)
        expect(await toNumber(endCIPT)).to.be.closeTo(await toNumber(startingCIPT.sub(tokensToLiquidate)), 0.0001, "Expected amount liquidated")

        let endIPT = await s.IPT.balanceOf(s.Dave.address)
        expect(await toNumber(endIPT)).to.be.closeTo(await toNumber(tokensToLiquidate), 0.001, "Dave received the underlying IPT")

        const usdiSpent = startingUSDA.sub(await s.USDA.balanceOf(s.Dave.address))

        //price - liquidation incentive (5%)
        const effectivePrice = (price.mul(BN("1e18").sub(s.LiquidationIncentive))).div(BN("1e18"))
        const realPrice = ((tokensToLiquidate.mul(effectivePrice)).div(tokensToLiquidate))
        expect(await toNumber(realPrice)).to.be.closeTo(await toNumber(effectivePrice), 0.001, "Effective price is correct")


        const profit = liquidationValue.sub(usdiSpent)
        const expected = (liquidationValue.mul(s.LiquidationIncentive)).div(BN("1e18"))

        expect(await toNumber(profit)).to.be.closeTo(await toNumber(expected), 0.1, "Expected profit achieved")


    })

    it("repay all", async () => {

        let liab = await s.VaultController.vaultLiability(s.BobVaultID)
        expect(liab).to.be.gt(0, "Liability exists")

        await s.VaultController.connect(s.Bob).repayAllUSDa(s.BobVaultID)
        await mineBlock()

        liab = await s.VaultController.vaultLiability(s.BobVaultID)
        expect(liab).to.eq(0, "Loan completely repaid")
    })


    it("Withdraw after loan", async () => {

        const voteVaultIPT = await s.IPT.balanceOf(s.BobVotingVault.address)
        expect(voteVaultIPT).to.be.gt(0, "Vote vault holds IPT")
        const vaultCappedIPT = await s.cIPT.balanceOf(s.BobVault.address)

        await s.BobVault.connect(s.Bob).withdrawErc20(s.cIPT.address, vaultCappedIPT)
        await mineBlock()

        let balance = await s.IPT.balanceOf(s.BobVotingVault.address)
        expect(await toNumber(balance)).to.eq(0, "All IPT withdrawn")

        balance = await s.cIPT.balanceOf(s.BobVault.address)
        expect(await toNumber(balance)).to.eq(0, "All CappedIPT removed from vault")

        const supply = await s.cIPT.totalSupply()
        expect(supply).to.eq(69, "All New CappedIPT Burned")

        balance = await s.IPT.balanceOf(s.Bob.address)
        expect(await toNumber(balance)).to.be.closeTo(await toNumber(s.aaveAmount.sub(T2L)), 2, "Bob received collateral - liquidated amount")

    })

    it("mappings", async () => {
        const _vaultAddress_vaultId = await s.VotingVaultController._vaultAddress_vaultId(s.BobVault.address)
        expect(_vaultAddress_vaultId.toNumber()).to.eq(s.BobVaultID.toNumber(), "Correct vault ID")

        const _vaultId_votingVaultAddress = await s.VotingVaultController._vaultId_votingVaultAddress(BN(s.BobVaultID))
        expect(_vaultId_votingVaultAddress.toUpperCase()).to.equal(s.BobVotingVault.address.toUpperCase(), "Correct voting vault ID")

        const _votingVaultAddress_vaultId = await s.VotingVaultController._votingVaultAddress_vaultId(s.BobVotingVault.address)
        expect(_votingVaultAddress_vaultId.toNumber()).to.eq(s.BobVaultID.toNumber(), "Correct vault ID")

        const _underlying_CappedToken = await s.VotingVaultController._underlying_CappedToken(s.IPT.address)
        expect(_underlying_CappedToken.toUpperCase()).to.eq(s.cIPT.address.toUpperCase(), "Underlying => Capped is correct")

        const _CappedToken_underlying = await s.VotingVaultController._CappedToken_underlying(s.cIPT.address)
        expect(_CappedToken_underlying.toUpperCase()).to.eq(s.IPT.address.toUpperCase(), "Capped => Underlying correct")
    })
     
}) 
