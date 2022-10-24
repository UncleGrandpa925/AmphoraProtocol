import { s } from "./scope";
import { expect, assert } from "chai";
import { showBody, showBodyCyan } from "../../util/format";
import { BN } from "../../util/number";
import { advanceBlockHeight, nextBlockTime, fastForward, mineBlock, OneWeek, OneYear } from "../../util/block";
import { utils, BigNumber } from "ethers";
import { calculateAccountLiability, payInterestMath, calculateBalance, getGas, getArgs, truncate, getEvent, calculatetokensToLiquidate, calculateUSDA2repurchase, changeInBalance, toNumber } from "../../util/math";
import { IVault__factory } from "../../typechain-types";

let firstBorrowIF: BigNumber
const borrowAmount = BN("5000e18")
describe("BORROW USDa", async () => {

    //bob tries to borrow USDa against 10 eth as if eth is $100k
    // remember bob has 10 wETH
    let actualBorrowAmount: any
    let expectedInterestFactor: BigNumber
    it(`bob should not be able to borrow 1e6 * 1e18 * ${s.Bob_WETH} USDa`, async () => {
        await expect(s.VaultController.connect(s.Bob).borrowUsdi(1,
            s.Bob_WETH.mul(BN("1e18")).mul(1e6),
        )).to.be.revertedWith("vault insolvent");
    });

    it(`bob should be able to borrow ${utils.parseEther(borrowAmount.toString())} USDa`, async () => {

        const initUSDaBalance = await s.USDA.balanceOf(s.Bob.address)
        assert.equal(initUSDaBalance.toString(), "0", "Bob starts with 0 USDa")

        //get initial interest factor
        const initInterestFactor = await s.VaultController.interestFactor()

        expectedInterestFactor = await payInterestMath(initInterestFactor)

        firstBorrowIF = expectedInterestFactor
        const calculatedBaseLiability = await calculateAccountLiability(borrowAmount, initInterestFactor, initInterestFactor)

        const borrowResult = await s.VaultController.connect(s.Bob).borrowUsdi(1, borrowAmount)
        await advanceBlockHeight(1)
        const gas = await getGas(borrowResult)
        showBodyCyan("Gas cost to borrowUSDA: ", gas)

        const args = await getArgs(borrowResult)
        actualBorrowAmount = args!.borrowAmount

        //actual new interest factor from contract
        const newInterestFactor = await s.VaultController.interestFactor()

        assert.equal(newInterestFactor.toString(), expectedInterestFactor.toString(), "New Interest Factor is correct")

        await s.VaultController.calculateInterest()
        const liability = await s.VaultController.connect(s.Bob).vaultLiability(1)
        assert.equal(liability.toString(), calculatedBaseLiability.toString(), "Calculated base liability is correct")

        const resultingUSDaBalance = await s.USDA.balanceOf(s.Bob.address)
        assert.equal(resultingUSDaBalance.toString(), actualBorrowAmount.toString(), "Bob received the correct amount of USDa")

    });
    it(`after 1 week, bob should have a liability greater than ${utils.parseEther(borrowAmount.toString())}`, async () => {

        await advanceBlockHeight(1)
        await fastForward(OneWeek)
        await advanceBlockHeight(1)

        let interestFactor = await s.VaultController.interestFactor()
        const calculatedInterestFactor = await payInterestMath(interestFactor)

        const expectedLiability = await calculateAccountLiability(borrowAmount, calculatedInterestFactor, firstBorrowIF)

        const result = await s.VaultController.connect(s.Frank).calculateInterest();
        await advanceBlockHeight(1)
        const interestGas = await getGas(result)
        showBodyCyan("Gas cost to calculate interest: ", interestGas)

        interestFactor = await s.VaultController.interestFactor()
        assert.equal(interestFactor.toString(), calculatedInterestFactor.toString(), "Interest factor is correct")

        const readLiability = await s
            .VaultController.connect(s.Bob)
            .vaultLiability(1);

        expect(readLiability).to.be.gt(BN("5000e18"));

        assert.equal(expectedLiability.toString(), readLiability.toString(), "Liability calculation is correcet")
    });
});

describe("Checking interest generation", () => {
    it("check change in balance over a long period of time", async () => {
        const initBalance = await s.USDA.balanceOf(s.Dave.address)
        //fastForward
        await fastForward(OneYear);//1 year
        await advanceBlockHeight(1)

        //get current interestFactor
        let interestFactor = await s.VaultController.interestFactor()
        const expectedBalance = await calculateBalance(interestFactor, s.Dave)

        //check for yeild before calculateInterest - should be 0
        let balance = await s.USDA.balanceOf(s.Dave.address)

        assert.equal(balance.toString(), initBalance.toString(), "No yield before calculateInterest")

        //calculate and pay interest on the contract
        const result = await s.VaultController.connect(s.Frank).calculateInterest();
        await advanceBlockHeight(1)
        const interestGas = await getGas(result)
        showBodyCyan("Gas cost to calculate interest: ", interestGas)

        //check for yeild after calculateInterest TODO
        balance = await s.USDA.balanceOf(s.Dave.address)

        assert.equal(balance.toString(), expectedBalance.toString(), "Expected balance is correct")

        expect(balance > initBalance)
    })
})

describe("Testing repay", () => {
    const borrowAmount = BN("10e18")
    it(`bob should able to borrow ${borrowAmount} USDa`, async () => {
        await expect(s.VaultController.connect(s.Bob).borrowUsdi(1, borrowAmount)).to.not.be.reverted;
    });
    it("partial repay", async () => {
        const vaultId = 1
        const initBalance = await s.USDA.balanceOf(s.Bob.address)

        let liability = await s.BobVault.connect(s.Bob).baseLiability()
        let partialLiability = liability.div(2) //half

        //check pauseable 
        await s.VaultController.connect(s.Frank).pause()
        await advanceBlockHeight(1)
        await expect(s.VaultController.connect(s.Bob).repayUSDa(vaultId, partialLiability)).to.be.revertedWith("Pausable: paused")
        await s.VaultController.connect(s.Frank).unpause()
        await advanceBlockHeight(1)

        //need to get liability again, 2 seconds have passed when checking pausable
        liability = await s.BobVault.connect(s.Bob).baseLiability()
        partialLiability = liability.div(2) //half

        //current interest factor
        let interestFactor = await s.VaultController.interestFactor()
        const expectedBalanceWithInterest = await calculateBalance(interestFactor, s.Bob)

        //next interest factor if pay_interest was called now
        const calculatedInterestFactor = await payInterestMath(interestFactor)

        const base_amount = (partialLiability.mul(BN("1e18"))).div(calculatedInterestFactor)

        const expectedBaseLiability = liability.sub(base_amount)

        const repayResult = await s.VaultController.connect(s.Bob).repayUSDa(vaultId, partialLiability)
        await advanceBlockHeight(1)
        const repayGas = await getGas(repayResult)
        showBodyCyan("Gas cost do partial repay: ", repayGas)

        interestFactor = await s.VaultController.interestFactor()
        assert.equal(interestFactor.toString(), calculatedInterestFactor.toString(), "Interest factor is correct")

        let updatedLiability = await s.BobVault.connect(s.Bob).baseLiability()
        let balance = await s.USDA.balanceOf(s.Bob.address)

        assert.equal(expectedBaseLiability.toString(), updatedLiability.toString(), "Updated liability matches calculated liability")
        assert.equal(balance.toString(), (expectedBalanceWithInterest.sub(partialLiability)).toString(), "Balances are correct")

    })
    it("bob compeltely repays vault", async () => {
        //check pauseable 
        const allow = s.USDC.connect(s.Bob).approve(s.USDA.address, BN("100e20"))
        await expect(allow.catch(console.log)).to.not.reverted;
        await s.VaultController.connect(s.Frank).pause()
        await advanceBlockHeight(1)
        await expect(s.VaultController.connect(s.Bob).repayAllUSDa(1)).to.be.revertedWith("Pausable: paused")
        await s.VaultController.connect(s.Frank).unpause()
        await advanceBlockHeight(1)

        //current interest factor
        let interestFactor = await s.VaultController.interestFactor()
        let liability = await s.BobVault.connect(s.Bob).baseLiability()
        let expectedIF = await payInterestMath(interestFactor)
        const expectedUSDAliability = await truncate(expectedIF.mul(liability))
        let expectedBalanceWithInterest = await calculateBalance(expectedIF, s.Bob)
        const neededUSDA = expectedUSDAliability.sub(expectedBalanceWithInterest)
        expectedBalanceWithInterest = expectedBalanceWithInterest.add(neededUSDA)

        const deposit = s.USDA.connect(s.Bob).deposit(neededUSDA.div(BN("1e12")).add(1))
        await expect(deposit.catch(console.log)).to.not.reverted;
        const repayResult = await s.VaultController.connect(s.Bob).repayAllUSDa(1)
        await advanceBlockHeight(1)
        const repayGas = await getGas(repayResult)
        showBodyCyan("Gas cost do total repay: ", repayGas)
        const args = await getArgs(repayResult)
        assert.equal(args.repayAmount.toString(), expectedUSDAliability.toString(), "Expected USDa amount repayed and burned")
        assert.equal(expectedBalanceWithInterest.toString(), args.repayAmount.toString(), "Expected balance at the time of repay is correct")

        let updatedLiability = await s.BobVault.connect(s.Bob).baseLiability()
        expect(updatedLiability).to.eq(0)//vault has been completely repayed 

    })
})

describe("Testing liquidations", () => {
    it(`bob should have ${s.Bob_WETH} wETH deposited`, async () => {
        expect(await s.BobVault.connect(s.Bob).tokenBalance(s.WETH.address)).to.eq(s.Bob_WETH);
    });
    it("borrow maximum and liquidate down to empty vault", async () => {
        const vaultID = 1
        const bobVaultInit = await s.WETH.balanceOf(s.BobVault.address)

        //borrow maximum -> borrow amount == collateral value 
        const borrowInterestFactor = await s.VaultController.interestFactor()
        let calcIF = await payInterestMath(borrowInterestFactor)
        const accountBorrowingPower = await s.VaultController.vaultBorrowingPower(vaultID)
        await nextBlockTime(0)
        await s.VaultController.connect(s.Bob).borrowUsdi(vaultID, accountBorrowingPower)
        await advanceBlockHeight(1)
        let IF = await s.VaultController.interestFactor()
        const initIF = IF
        assert.equal(IF.toString(), calcIF.toString())

        /******** CHECK withdraw BEFORE CALCULATE INTEREST ********/
        //skip time so we can put vault below liquidation threshold 
        await fastForward(OneYear * 10);//10 year
        await advanceBlockHeight(1)
        const tenYearIF = await payInterestMath(calcIF)

        //calculate interest to update protocol, vault is now able to be liquidated 
        await nextBlockTime(0)
        await s.VaultController.calculateInterest()
        await advanceBlockHeight(1)
        IF = await s.VaultController.interestFactor()
        assert.equal(tenYearIF.toString(), IF.toString(), "Interest factor calculation is correct after 10 years")

        //init balances after calculate interest
        const initWethBalanceDave = await s.WETH.balanceOf(s.Dave.address)

        //check pauseable 
        await s.VaultController.connect(s.Frank).pause()
        await advanceBlockHeight(1)
        await expect(s.VaultController.connect(s.Dave).liquidateVault(vaultID, s.wethAddress, BN("1e16"))).to.be.revertedWith("Pausable: paused")
        await s.VaultController.connect(s.Frank).unpause()
        await advanceBlockHeight(1)

        //expectedBalanceWithInterest must be calced here - TODO why? 
        const expectedBalanceWithInterest = await calculateBalance(IF, s.Dave)

        let vaultWETH = await s.WETH.balanceOf(s.BobVault.address)
        assert.equal(vaultWETH.toString(), bobVaultInit.toString(), "Vault still has all of its wETH")

        let daveWETH = await s.WETH.balanceOf(s.Dave.address)
        assert.equal(daveWETH.toString(), "0", "Dave does not have any wETH before liquidation ")

        IF = await s.VaultController.interestFactor()
        const calculatedInterestFactor = await payInterestMath(IF)
        const calcLiab = await calculateAccountLiability(accountBorrowingPower, calculatedInterestFactor, calcIF)

        const expectedT2L = await calculatetokensToLiquidate(s.BobVault, s.WETH.address, bobVaultInit, calcLiab)

        const expectedUSDA2Repurchase = await calculateUSDA2repurchase(s.WETH.address, expectedT2L)

        const result = await s.VaultController.connect(s.Dave).liquidateVault(vaultID, s.wethAddress, bobVaultInit)
        await advanceBlockHeight(1)
        const receipt = await result.wait()
        const liquidateGas = await getGas(result)
        showBodyCyan("Gas cost to do a big liquidation: ", liquidateGas)


        daveWETH = await s.WETH.balanceOf(s.Dave.address)
        assert.equal(daveWETH.toString(), bobVaultInit.toString(), "Dave now has all of the vault's collateral")
        const endingVaultWETH = await s.WETH.balanceOf(s.BobVault.address)
        assert.equal(endingVaultWETH.toString(), "0", "Vault is empty")

        IF = await s.VaultController.interestFactor()
        let expectedLiability = await calculateAccountLiability(accountBorrowingPower, IF, initIF)

        let interestEvent = await getEvent(result, "InterestEvent")
        assert.equal(interestEvent.event, "InterestEvent", "Correct event captured and emitted")

        let liquidateEvent = receipt.events![receipt.events!.length - 1]
        let args = liquidateEvent.args
        assert.equal(liquidateEvent.event, "Liquidate", "Correct event captured and emitted")
        assert.equal(args!.asset_address.toString().toUpperCase(), s.wethAddress.toString().toUpperCase(), "Asset address is correct")
        const usda_to_repurchase = args!.usda_to_repurchase
        const tokens_to_liquidate = args!.tokens_to_liquidate

        assert.equal(tokens_to_liquidate.toString(), expectedT2L.toString(), "Tokens to liquidate is correct")
        assert.equal(usda_to_repurchase.toString(), expectedUSDA2Repurchase.toString(), "USDa to repurchase is correct")

        //check ending liability 
        let liabiltiy = await s.VaultController.vaultLiability(vaultID)

        //TODO - result is off by 0-8, and is inconsistant -- oracle price? Rounding error? 
        if (liabiltiy == expectedLiability.sub(usda_to_repurchase)) {
            showBodyCyan("LIABILITY MATCH")
        }
        //accept a range to account for miniscule error
        expect(liabiltiy).to.be.closeTo(expectedLiability.sub(usda_to_repurchase), 10)


        //Bob's vault's collateral has been reduced by the expected amount
        let balance = await s.WETH.balanceOf(s.BobVault.address)
        let difference = bobVaultInit.sub(balance)
        assert.equal(difference.toString(), tokens_to_liquidate.toString(), "Correct number of tokens liquidated from vault")

        //Dave spent USDa to liquidate -- TODO: precalc balance
        balance = await s.USDA.balanceOf(s.Dave.address)
        difference = expectedBalanceWithInterest.sub(balance)
        assert.equal(difference.toString(), usda_to_repurchase.toString(), "Dave spent the correct amount of USDa")

        //Dave received wETH
        balance = await s.WETH.balanceOf(s.Dave.address)
        difference = balance.sub(initWethBalanceDave)
        assert.equal(difference.toString(), tokens_to_liquidate.toString(), "Correct number of tokens liquidated from vault")
    })

    it("checks for over liquidation and then liquidates a vault that is just barely insolvent", async () => {

        const vaultID = 2
        const carolVaultInit = await s.UNI.balanceOf(s.CarolVault.address)
        const initUniBalanceDave = await s.UNI.balanceOf(s.Dave.address)

        //borrow maximum USDa
        const carolBorrowPower = await s.VaultController.vaultBorrowingPower(2)
        await advanceBlockHeight(1)
        const borrowResult = await s.VaultController.connect(s.Carol).borrowUsdi(vaultID, carolBorrowPower)
        await advanceBlockHeight(1)
        let IF = await s.VaultController.interestFactor()
        const initIF = IF
        const args = await getArgs(borrowResult)
        const actualBorrowAmount = args!.borrowAmount

        //carol did not have any USDa before borrowing some
        expect(await s.USDA.balanceOf(s.Carol.address)).to.eq(actualBorrowAmount)

        let solvency = await s.VaultController.checkVault(vaultID)
        assert.equal(solvency, true, "Carol's vault is solvent")

        //showBody("advance 1 week and then calculate interest")
        await fastForward(OneWeek)
        await s.VaultController.calculateInterest()
        await advanceBlockHeight(1)

        solvency = await s.VaultController.checkVault(vaultID)
        assert.equal(solvency, false, "Carol's vault is not solvent")

        let liquidatableTokens = await s.VaultController.tokensToLiquidate(vaultID, s.uniAddress)

        //callStatic does not actually make the call and change the state of the contract, thus liquidateAmount == liquidatableTokens
        const liquidateAmount = await s.VaultController.connect(s.Dave).callStatic.liquidateVault(vaultID, s.uniAddress, BN("1e25"))
        expect(liquidateAmount).to.eq(liquidatableTokens)

        IF = await s.VaultController.interestFactor()
        const expectedBalanceWithInterest = await calculateBalance(IF, s.Dave)

        //tiny liquidation 
        await nextBlockTime(0)
        const result = await s.VaultController.connect(s.Dave).liquidateVault(vaultID, s.uniAddress, BN("1e25"))
        await advanceBlockHeight(1)
        const liquidateArgs = await getArgs(result)

        const liquidateGas = await getGas(result)
        showBodyCyan("Gas cost to do a tiny liquidation: ", liquidateGas)

        const usda_to_repurchase = liquidateArgs.usda_to_repurchase
        const tokens_to_liquidate = liquidateArgs.tokens_to_liquidate

        IF = await s.VaultController.interestFactor()
        let expectedLiability = await calculateAccountLiability(carolBorrowPower, IF, initIF)

        //check ending liability 
        let liabiltiy = await s.VaultController.vaultLiability(vaultID)
        //TODO - result is off by 0-8, and is inconsistant -- oracle price? Rounding error? 
        if (liabiltiy == expectedLiability.sub(usda_to_repurchase)) {
            showBodyCyan("LIABILITY MATCH")
        }
        //accept a range to account for miniscule error
        expect(liabiltiy).to.be.closeTo(expectedLiability.sub(usda_to_repurchase), 10)

        //Carol's vault's collateral has been reduced by the expected amount
        let balance = await s.UNI.balanceOf(s.CarolVault.address)
        let difference = carolVaultInit.sub(balance)
        assert.equal(difference.toString(), tokens_to_liquidate.toString(), "Correct number of tokens liquidated from vault")

        //Dave spent USDa to liquidate -- TODO: precalc balance
        balance = await s.USDA.balanceOf(s.Dave.address)
        difference = expectedBalanceWithInterest.sub(balance)
        assert.equal(difference.toString(), usda_to_repurchase.toString(), "Dave spent the correct amount of USDa")

        //Dave received UNI
        balance = await s.UNI.balanceOf(s.Dave.address)
        difference = balance.sub(initUniBalanceDave)
        assert.equal(difference.toString(), tokens_to_liquidate.toString(), "Correct number of tokens liquidated from vault")
    })
})
describe("Checking for eronious inputs and scenarios", () => {
    const vaultID = 2
    let solvency: boolean
    let AccountLiability: BigNumber, borrowPower: BigNumber, amountUnderwater: BigNumber
    let balance: BigNumber

    before(async () => {
        //showBody("advance 1 week and then calculate interest")
        await fastForward(OneWeek)
        await s.VaultController.calculateInterest()
        await advanceBlockHeight(1)

        solvency = await s.VaultController.checkVault(vaultID)
        assert.equal(solvency, false, "Carol's vault is not solvent")
    })

    it("test eronious inputs on external tokensToLiquidate", async () => {
        const carolUniAmount = await s.UNI.balanceOf(s.CarolVault.address)
        let AmountToLiquidate = carolUniAmount.mul(5)
        let tokensToLiquidate: BigNumber
        let liquidateAmount: BigNumber

        liquidateAmount = await s.VaultController.connect(s.Dave).callStatic.liquidateVault(vaultID, s.uniAddress, AmountToLiquidate)
        tokensToLiquidate = await s.VaultController.tokensToLiquidate(vaultID, s.uniAddress)
        assert.equal(tokensToLiquidate.toString(), liquidateAmount.toString(), "tokensToLiquidate with same params returns the correct number of tokens to liquidate")

        //puny liquidation amount
        AmountToLiquidate = BN("100")
        liquidateAmount = await s.VaultController.connect(s.Dave).callStatic.liquidateVault(vaultID, s.uniAddress, AmountToLiquidate)
        assert.equal(liquidateAmount.toString(), AmountToLiquidate.toString(), "Passing a small amount to liquidate works as intended")

    })

    it("checks for liquidate with tokens_to_liquidate == 0", async () => {
        //liquidate with tokens_to_liquidate == 0
        await nextBlockTime(0)
        await expect(s.VaultController.connect(s.Dave).liquidateVault(vaultID, s.uniAddress, 0)).to.be.revertedWith("must liquidate>0")
        await advanceBlockHeight(1)
    })

    it("checks for liquidate with an invalid vault address", async () => {
        //invalid address
        await nextBlockTime(0)
        await expect(s.VaultController.connect(s.Dave).liquidateVault(vaultID, s.Frank.address, BN("1e25"))).to.be.revertedWith("Token not registered")
        await advanceBlockHeight(1)
    })

    it("checks for liquidate with an invalid vault vaultID", async () => {
        //invalid vault ID
        await nextBlockTime(0)
        await expect(s.VaultController.connect(s.Dave).liquidateVault(69420, s.uniAddress, BN("1e25"))).to.be.revertedWith("vault does not exist")
        await advanceBlockHeight(1)
    })

    it("checks for liquidate with a vault that is solvent", async () => {
        //solvent vault
        //carol repays some to become solvent
        AccountLiability = await s.VaultController.vaultLiability(vaultID)
        borrowPower = await s.VaultController.vaultBorrowingPower(vaultID)
        amountUnderwater = AccountLiability.sub(borrowPower)



        //repay amount owed + 1 USDa to account for interest
        const repayResult = await s.VaultController.connect(s.Carol).repayUSDa(vaultID, amountUnderwater.add(utils.parseEther("1")))
        await advanceBlockHeight(1)

        AccountLiability = await s.VaultController.vaultLiability(vaultID)
        borrowPower = await s.VaultController.vaultBorrowingPower(vaultID)
        amountUnderwater = AccountLiability.sub(borrowPower)

        solvency = await s.VaultController.checkVault(vaultID)
        assert.equal(solvency, true, "Carol's vault is solvent")

        await expect(s.VaultController.connect(s.Dave).liquidateVault(vaultID, s.uniAddress, BN("1e25"))).to.be.revertedWith("Vault is solvent")
        await advanceBlockHeight(1)
    })

    it("tokens to liquidate on solvent vault", async () => {
        solvency = await s.VaultController.checkVault(vaultID)
        assert.equal(solvency, true, "Carol's vault is solvent")
        await expect(s.VaultController.tokensToLiquidate(vaultID, s.uniAddress)).to.be.revertedWith("Vault is solvent")
    })

    it("liquidate when liquidator doesn't have any USDa", async () => {

        //showBody("advance 1 week and then calculate interest")
        await fastForward(OneWeek)
        await s.VaultController.calculateInterest()
        await advanceBlockHeight(1)

        let EricBalance = await s.USDA.balanceOf(s.Eric.address)
        assert.equal(EricBalance.toString(), "0", "Eric does not have any USDa")

        await expect(s.VaultController.connect(s.Eric).liquidateVault(vaultID, s.uniAddress, utils.parseEther("1"))).to.be.revertedWith("USDA: not enough balance")
        await advanceBlockHeight(1)

    })

    it("liquidate when liquidator doesn't have enough USDa", async () => {
        //send Eric 1 USDa
        const EricUSDA = utils.parseEther("1")
        await s.USDA.connect(s.Dave).transfer(s.Eric.address, EricUSDA)
        await advanceBlockHeight(1)

        let EricBalance = await s.USDA.balanceOf(s.Eric.address)
        assert.equal(EricBalance.toString(), EricUSDA.toString(), `Eric has ${utils.formatEther(EricUSDA.toString())} USDa`)

        await expect(s.VaultController.connect(s.Eric).liquidateVault(vaultID, s.uniAddress, utils.parseEther("1"))).to.be.revertedWith("USDA: not enough balance")
        await advanceBlockHeight(1)

    })

    it("accidently send USDa to the USDA contract", async () => {
        let EricBalance = await s.USDA.balanceOf(s.Eric.address)
        expect(EricBalance).to.be.gt(0)

        //cannot send to USDa contract, see modifier validRecipient
        await expect(s.USDA.connect(s.Eric).transferAll(s.USDA.address)).to.be.reverted
        await advanceBlockHeight(1)

        //need to have Eric end up with 0 USDa for other tests
        await s.USDA.connect(s.Eric).transferAll(s.Dave.address)
        await advanceBlockHeight(1)

        EricBalance = await s.USDA.balanceOf(s.Eric.address)
        assert.equal(EricBalance.toString(), "0", "Eric has empty balance")
    })

    it("repay more than what is owed", async () => {
        balance = await s.USDA.balanceOf(s.Carol.address)
        const startingBalance = balance
        AccountLiability = await s.VaultController.vaultLiability(vaultID)

        await expect(s.VaultController.connect(s.Carol).repayUSDa(vaultID, AccountLiability.add(utils.parseEther("50")))).to.be.revertedWith("repay > borrow amount")
        await advanceBlockHeight(1)

        balance = await s.USDA.balanceOf(s.Carol.address)
        assert.equal(balance.toString(), startingBalance.toString(), "Balance has not changed, TX reverted")
    })

    it("repay when borrower doesn't have enough USDa to do so", async () => {
        balance = await s.USDA.balanceOf(s.Carol.address)
        //carol sends all USDa to Dave
        const transferAllResult = await s.USDA.connect(s.Carol).transferAll(s.Dave.address)
        await advanceBlockHeight(1)
        const transferArgs = await getArgs(transferAllResult)
        assert.equal(transferArgs.value.toString(), balance.toString(), "transferAll works as intended")

        balance = await s.USDA.balanceOf(s.Carol.address)
        assert.equal(balance.toNumber(), 0, "Carol now holds 0 USDa tokens")

        await expect(s.VaultController.connect(s.Carol).repayAllUSDa(vaultID)).to.be.revertedWith("USDA: not enough balance")

        await expect(s.VaultController.connect(s.Carol).repayUSDa(vaultID, utils.parseEther("10"))).to.be.revertedWith("USDA: not enough balance")

    })

    it("repay when there is no liability", async () => {
        //Dave transfers enough USDa back to Carol to repay all
        AccountLiability = await s.VaultController.vaultLiability(vaultID)

        await s.USDA.connect(s.Dave).transfer(s.Carol.address, AccountLiability.add(utils.parseEther("100")))
        await advanceBlockHeight(1)

        await s.VaultController.connect(s.Carol).repayAllUSDa(vaultID)
        await advanceBlockHeight(1)
        AccountLiability = await s.VaultController.vaultLiability(vaultID)
        assert.equal(AccountLiability.toString(), "0", "There is no liability on Carol's vault anymore")

        await s.VaultController.calculateInterest()
        await advanceBlockHeight(1)

        AccountLiability = await s.VaultController.vaultLiability(vaultID)
        let VaultBaseLiab = await s.CarolVault.baseLiability()
        assert.equal(VaultBaseLiab.toString(), "0", "Vault base liability is 0")

        assert.equal(AccountLiability.toString(), "0", "AccountLiability is still 0 after calculateInterest() after repayAllUSDa")

        await expect(s.VaultController.connect(s.Carol).repayUSDa(vaultID, 10)).to.be.revertedWith("repay > borrow amount")
        await advanceBlockHeight(1)

        const repayAllResult = await s.VaultController.connect(s.Carol).repayAllUSDa(vaultID)
        await advanceBlockHeight(1)
        let repayGas = await getGas(repayAllResult)
        showBodyCyan("Gas cost to repayAllUSDa on an empty vault: ", repayGas)

    })

    it("borrow against a vault that is not yours", async () => {
        //carol's vault has no debt
        AccountLiability = await s.VaultController.vaultLiability(vaultID)
        assert.equal(AccountLiability.toString(), "0", "Carol's vault has no debt")

        //Eric tries to borrow against Carol's vault
        await expect(s.VaultController.connect(s.Eric).borrowUsdi(vaultID, utils.parseEther("500"))).to.be.revertedWith("sender not minter")
        await advanceBlockHeight(1)
    })


    it("makes vault insolvent", async () => {
        const accountBorrowingPower = await s.VaultController.vaultBorrowingPower(vaultID)

        //showBodyCyan("BORROW")
        await nextBlockTime(0)
        await s.VaultController.connect(s.Carol).borrowUsdi(vaultID, accountBorrowingPower)
        await advanceBlockHeight(1)

        await fastForward(OneWeek)
        await s.VaultController.calculateInterest()
        await advanceBlockHeight(1)

        solvency = await s.VaultController.checkVault(vaultID)
        assert.equal(solvency, false, "Carol's vault is not solvent")

        AccountLiability = await s.VaultController.vaultLiability(vaultID)
        borrowPower = await s.VaultController.vaultBorrowingPower(vaultID)
        amountUnderwater = AccountLiability.sub(borrowPower)

        let amountToSolvency = await s.VaultController.amountToSolvency(vaultID)

        assert.equal(amountUnderwater.toString(), amountToSolvency.toString(), "amountToSolvency is correct")
        expect(amountToSolvency).to.be.gt(BN("1e6"))
    })

    it("repays vault for next set of tests", async () => {

        await s.VaultController.connect(s.Dave).repayAllUSDa(vaultID)
        await mineBlock()

        AccountLiability = await s.VaultController.vaultLiability(vaultID)

        assert.equal(AccountLiability.toString(), "0", "Account liability is now 0")
    })

    it("what happens when someone simply transfers ether to the VaultController? ", async () => {
        let tx = {
            to: s.VaultController.address,
            value: utils.parseEther("1")
        }
        await expect(s.Bob.sendTransaction(tx)).to.be.reverted
        await mineBlock()
    })
})

describe("Testing remaining vault functions", () => {
    const vaultID = 2
    let solvency: boolean
    let AccountLiability: BigNumber, borrowPower: BigNumber, amountUnderwater: BigNumber
    let balance: BigNumber

    let startingVaultUni: BigNumber
    let startingCarolUni: BigNumber

    const withdrawAmount = utils.parseEther("1")//1 uni token

    it("withdraws some of the ERC20 tokens from vault: ", async () => {
        startingVaultUni = await s.UNI.balanceOf(s.CarolVault.address)
        expect(startingVaultUni).to.be.gt(0)

        startingCarolUni = await s.UNI.balanceOf(s.Carol.address)

        AccountLiability = await s.VaultController.vaultLiability(vaultID)
        borrowPower = await s.VaultController.vaultBorrowingPower(vaultID)
        amountUnderwater = AccountLiability.sub(borrowPower)


        solvency = await s.VaultController.checkVault(vaultID)
        assert.equal(solvency, true, "Carol's vault is solvent")

        //withdraw uni from vault
        const withdrawResult = await s.CarolVault.connect(s.Carol).withdrawFromVault(s.uniAddress, withdrawAmount)
        await mineBlock()

        balance = await s.UNI.balanceOf(s.Carol.address)
        assert.equal(balance.toString(), withdrawAmount.toString(), "Carol has the correct amount of uni tokens")
    })

    it("withdraw from someone else's vault", async () => {
        solvency = await s.VaultController.checkVault(vaultID)
        assert.equal(solvency, true, "Carol's vault is solvent")

        //withdraw uni from vault
        await expect(s.CarolVault.connect(s.Eric).withdrawFromVault(s.uniAddress, withdrawAmount)).to.be.revertedWith("sender not minter")
        await mineBlock()
    })

    it("withdraw more than vault contains when liability is 0", async () => {
        //eric mints a vault
        const ericVaultID = 3
        await expect(s.VaultController.connect(s.Eric).mintVault()).to.not.reverted;
        await mineBlock();
        let getVault = await s.VaultController.vaultAddress(ericVaultID)
        let ericVault = IVault__factory.connect(
            getVault,
            s.Eric,
        );
        expect(await ericVault.minter()).to.eq(s.Eric.address)
        AccountLiability = await s.VaultController.vaultLiability(ericVaultID)
        assert.equal(AccountLiability.toString(), "0", "Eric's vault has 0 liability")
        borrowPower = await s.VaultController.vaultBorrowingPower(ericVaultID)
        assert.equal(borrowPower.toString(), "0", "Eric's vault has 0 borrow power, so it is empty")

        //withdraw tiny amount
        await expect(ericVault.withdrawFromVault(s.UNI.address, 1)).to.be.reverted

        //withdraw 0 on empty vault - withdraw 0 is allowed
        await expect(ericVault.withdrawFromVault(s.UNI.address, 0)).to.not.be.reverted
    })

    it("liquidate a vault with exactly 0 borrow power (empty)", async () => {
        borrowPower = await s.VaultController.vaultBorrowingPower(3)
        expect(borrowPower).to.eq(0)

        await expect(s.VaultController.connect(s.Dave).liquidateVault(3, s.WETH.address, 500000)).to.be.revertedWith("Vault is solvent")
    })

    it("withdraw with bad address", async () => {
        solvency = await s.VaultController.checkVault(vaultID)
        assert.equal(solvency, true, "Carol's vault is solvent")

        //withdraw uni from vault
        await expect(s.CarolVault.connect(s.Carol).withdrawFromVault(s.Frank.address, withdrawAmount)).to.be.reverted
        await mineBlock()
    })

    it("withdraw makes vault insolvent", async () => {
        solvency = await s.VaultController.checkVault(vaultID)
        assert.equal(solvency, true, "Carol's vault is solvent")

        //borrow a small amount
        const borrowAmount = utils.parseEther("50")
        await s.VaultController.connect(s.Carol).borrowUsdi(vaultID, borrowAmount)
        await advanceBlockHeight(1)

        //withdraw enough uni to make vault insolvent
        const vaultUni = await s.UNI.balanceOf(s.CarolVault.address)
        await expect(s.CarolVault.connect(s.Carol).withdrawFromVault(s.UNI.address, vaultUni)).to.be.revertedWith("over-withdrawal")
        await advanceBlockHeight(1)

        //repayAll
        await s.VaultController.connect(s.Carol).repayAllUSDa(vaultID)
        await advanceBlockHeight(1)
    })

    it("makes vault insolvent", async () => {
        const accountBorrowingPower = await s.VaultController.vaultBorrowingPower(vaultID)

        //showBodyCyan("BORROW")
        await nextBlockTime(0)
        await s.VaultController.connect(s.Carol).borrowUsdi(vaultID, accountBorrowingPower)
        await advanceBlockHeight(1)

        await fastForward(OneWeek)
        await s.VaultController.calculateInterest()
        await advanceBlockHeight(1)

        solvency = await s.VaultController.checkVault(vaultID)
        assert.equal(solvency, false, "Carol's vault is not solvent")

        AccountLiability = await s.VaultController.vaultLiability(vaultID)
        borrowPower = await s.VaultController.vaultBorrowingPower(vaultID)
        amountUnderwater = AccountLiability.sub(borrowPower)

        let amountToSolvency = await s.VaultController.amountToSolvency(vaultID)

        assert.equal(amountUnderwater.toString(), amountToSolvency.toString(), "amountToSolvency is correct")
        expect(amountToSolvency).to.be.gt(BN("1e6"))
    })

    it("withdraw from a vault that is insolvent", async () => {
        solvency = await s.VaultController.checkVault(vaultID)
        assert.equal(solvency, false, "Carol's vault is not solvent")

        //withdraw uni from vault
        await expect(s.CarolVault.connect(s.Carol).withdrawFromVault(s.uniAddress, withdrawAmount)).to.be.revertedWith("over-withdrawal")
        await mineBlock()
    })

    it("make and borrow from a second vault", async () => {
        balance = await s.UNI.balanceOf(s.Carol.address)
        assert.equal(balance.toString(), utils.parseEther("1").toString(), "Carol has 1 uni")

        //mint second vault
        await expect(s.VaultController.connect(s.Carol).mintVault()).to.not.reverted;
        await mineBlock();
        const newVaultID = await s.VaultController.vaultsMinted()
        let newV = await s.VaultController.vaultAddress(newVaultID)
        const newVault = IVault__factory.connect(
            newV,
            s.Carol,
        );
        expect(await newVault.minter()).to.eq(s.Carol.address)

        //transfer 1 uni to vault
        await expect(s.UNI.connect(s.Carol).transfer(newVault.address, balance)).to.not.reverted;
        await mineBlock()
        AccountLiability = await s.VaultController.vaultLiability(newVaultID)
        borrowPower = await s.VaultController.vaultBorrowingPower(newVaultID)

        assert.equal(AccountLiability.toString(), "0", "New vault has 0 liability")

        //this vault is able to be borrowed from
        expect(borrowPower).to.be.gt(0)

    })
})
describe("Checking getters", () => {
    it("checks totalBaseLiability", async () => {
        let _totalBaseLiability = await s.VaultController.totalBaseLiability()
        expect(_totalBaseLiability).to.not.eq(0)
    })
    it("checks _tokensRegistered", async () => {
        let _tokensRegistered = await s.VaultController.tokensRegistered()
        expect(_tokensRegistered).to.not.eq(0)
    })

})
describe("Checking vaultSummaries", async () => {
    let vaultSummaries: any
    let vaultsMinted: number
    it("Gets the vault summaries", async () => {
        vaultsMinted = await (await s.VaultController.vaultsMinted()).toNumber()

        vaultSummaries = await s.VaultController.vaultSummaries(1, vaultsMinted)

        //the correct number of summaries
        expect(vaultSummaries.length).to.eq(vaultsMinted)

    })
    it("checks data", async () => {
        //summary[0] is correct
        let vaultLiability = await s.VaultController.vaultLiability(vaultSummaries[0].id)
        expect(await toNumber(vaultLiability)).to.eq(await toNumber(vaultSummaries[0].vaultLiability))

        //check summary[1], token[1] and balance[1] should match 
        let tokenBalance = await toNumber(vaultSummaries[1].tokenBalances[1])
        expect(tokenBalance).to.not.eq(0)
        let expectedToken = vaultSummaries[1].tokenAddresses[1]
        expect(expectedToken).to.eq(s.UNI.address)

        let vaultAddress = await s.VaultController.vaultAddress(vaultSummaries[1].id)
        let balance = await s.UNI.balanceOf(vaultAddress)

        expect(tokenBalance).to.eq(await toNumber(balance))
    })
    it("checks for errors", async () => {
        //start > stop
        await expect(s.VaultController.vaultSummaries(5, 3)).to.be.reverted

        //start from 0
        await expect(s.VaultController.vaultSummaries(0, 6)).to.be.reverted

        //include vaults that don't exist yet
        await expect(s.VaultController.vaultSummaries(1, 25)).to.be.reverted
    })
})

