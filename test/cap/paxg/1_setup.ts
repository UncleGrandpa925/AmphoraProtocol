import { expect, assert } from "chai"
import { ethers, network, tenderly } from "hardhat"
import { stealMoney } from "../../../util/money"
import { showBody } from "../../../util/format"
import { BN } from "../../../util/number"
import { s } from "../scope"
import { d } from "../DeploymentInfo"

import { advanceBlockHeight, reset, mineBlock } from "../../../util/block"
import { VotingVaultController__factory, IERC20__factory, IVOTE__factory, VaultController__factory, USDA__factory, OracleMaster__factory, CurveMaster__factory, ProxyAdmin__factory } from "../../../typechain-types"
import { toNumber } from "../../../util/math"
//import { assert } from "console"

require("chai").should()

const usdc_minter = "0xe78388b4ce79068e89bf8aa7f218ef6b9ab0e9d0"


if (process.env.TENDERLY_KEY) {
    if (process.env.TENDERLY_ENABLE == "true") {
        let provider = new ethers.providers.Web3Provider(tenderly.network())
        ethers.provider = provider
    }
}

describe("hardhat settings", () => {
    it("Set hardhat network to a block after deployment", async () => {
        expect(await reset(15480541)).to.not.throw//14940917
    })
    it("set automine OFF", async () => {
        expect(await network.provider.send("evm_setAutomine", [false])).to.not
            .throw
    })
})

describe("Token Setup", () => {
    it("connect to signers", async () => {
        s.accounts = await ethers.getSigners()
        s.Frank = s.accounts[0]
        s.Eric = s.accounts[5]
        s.Andy = s.accounts[6]
        s.Bob = s.accounts[7]
        s.Carol = s.accounts[8]
        s.Dave = s.accounts[9]
        s.Gus = s.accounts[10]
    })
    it("Connect to existing contracts", async () => {
        s.USDC = IERC20__factory.connect(s.usdcAddress, s.Frank)
        s.WETH = IERC20__factory.connect(s.wethAddress, s.Frank)
        s.UNI = IVOTE__factory.connect(s.uniAddress, s.Frank)
        s.WBTC = IERC20__factory.connect(s.wbtcAddress, s.Frank)

        s.PAXG = IERC20__factory.connect(s.PAXG_ADDR, s.Frank)

    })

    it("Connect to mainnet deployments for interest protocol", async () => {
        s.VaultController = VaultController__factory.connect(d.VaultController, s.Frank)
        s.USDA = USDA__factory.connect(d.USDA, s.Frank)
        s.Curve = CurveMaster__factory.connect(d.Curve, s.Frank)
        s.Oracle = OracleMaster__factory.connect(d.Oracle, s.Frank)

        s.ProxyAdmin = ProxyAdmin__factory.connect(d.ProxyAdmin, s.Frank)

        const vvc = "0xaE49ddCA05Fe891c6a5492ED52d739eC1328CBE2"
        s.VotingVaultController = VotingVaultController__factory.connect(vvc, s.Frank)


    })
    it("Should succesfully transfer PAXG to all users", async () => {

        await stealMoney(usdc_minter, s.Dave.address, s.USDC.address, BN("20000e6"))
        await mineBlock()

        for (let i = 0; i < s.accounts.length; i++) {
            await expect(
                stealMoney(s.PAXG_WHALE, s.accounts[i].address, s.PAXG_ADDR, s.PAXG_AMOUNT.add(BN("5e17")))//a little extra to cover fee
            ).to.not.be.reverted
            await mineBlock()
            expect(await toNumber(await s.PAXG.balanceOf(s.accounts[i].address))).to.be.closeTo(await toNumber(s.PAXG_AMOUNT.add(BN("5e17"))), 0.0021, "PAXG balance correct, accounting for fee on transfer")
        }

    })
})