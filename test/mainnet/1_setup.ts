import { expect, assert } from "chai";
import { ethers, network, tenderly} from "hardhat";
import { stealMoney } from "../../util/money";
import { showBody } from "../../util/format";
import { BN } from "../../util/number";
import { s } from "./scope";
import { advanceBlockHeight, reset, mineBlock } from "../../util/block";
import { IERC20__factory, IVOTE__factory } from "../../typechain-types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
//import { assert } from "console";

require("chai").should();
//*
// Initial Balances:
// Andy: 100,000,000 usdc ($100) 6dec
// Bob: 10,000,000,000,000,000,000 weth (10 weth) 18dec
// Carol: 100,000,000,000,000,000,000 (100 UNI), 18dec
// Dave: 10,000,000,000 usdc ($10,000) 6dec
//
// andy is a usdc holder. he wishes to deposit USDC to hold USDi
// bob is an eth holder. He wishes to deposit his eth and borrow USDi
// carol is a UNI holder. she wishes to deposit her UNI and then vote
// dave is a liquidator. he enjoys liquidating, so he's going to try to liquidate Bob

// configurable variables
let usdc_minter = "0xe78388b4ce79068e89bf8aa7f218ef6b9ab0e9d0";
let wbtc_minter = "0xf977814e90da44bfa03b6295a0616a897441acec"
let uni_minter = "0xf977814e90da44bfa03b6295a0616a897441acec"
let dydx_minter = "0xf977814e90da44bfa03b6295a0616a897441acec";
let ens_minter = "0xf977814e90da44bfa03b6295a0616a897441acec";
let aave_minter = "0xf977814e90da44bfa03b6295a0616a897441acec";
let tribe_minter = "0xf977814e90da44bfa03b6295a0616a897441acec";
let weth_minter = "0xe78388b4ce79068e89bf8aa7f218ef6b9ab0e9d0";


if (process.env.TENDERLY_KEY) {
    if (process.env.TENDERLY_ENABLE == "true") {
        let provider = new ethers.providers.Web3Provider(tenderly.network())
        ethers.provider = provider
    }
}
describe("hardhat settings", () => {
    it("reset hardhat network each run", async () => {
        expect(await reset(0)).to.not.throw;
    });
    it("set automine OFF", async () => {
        expect(await network.provider.send("evm_setAutomine", [false])).to.not
            .throw;
    });
});

describe("Token Setup", () => {
    it("connect to signers", async () => {
        let accounts = await ethers.getSigners();
        s.Frank = accounts[0];
        s.Eric = accounts[5];
        s.Andy = accounts[6];
        s.Bob = accounts[7];
        s.Carol = accounts[8];
        s.Dave = accounts[9];
        s.Gus = accounts[10];
    });
    it("Connect to existing contracts", async () => {
        s.USDC = IERC20__factory.connect(s.usdcAddress, s.Frank);
        s.WETH = IERC20__factory.connect(s.wethAddress, s.Frank);
        s.UNI = IVOTE__factory.connect(s.uniAddress, s.Frank);
        s.WBTC = IERC20__factory.connect(s.wbtcAddress, s.Frank);
        s.COMP = IVOTE__factory.connect(s.compAddress, s.Frank);
        s.ENS = IVOTE__factory.connect(s.ensAddress, s.Frank);
        s.DYDX = IVOTE__factory.connect(s.dydxAddress, s.Frank);
        s.AAVE = IVOTE__factory.connect(s.aaveAddress, s.Frank);
        s.TRIBE = IVOTE__factory.connect(s.tribeAddress, s.Frank);

    });
    it("Should succesfully transfer money", async () => {
        //showBody(`stealing ${s.Andy_USDC} to andy from ${s.usdcAddress}`);
        await expect(
            stealMoney(usdc_minter, s.Andy.address, s.usdcAddress, s.Andy_USDC)
        ).to.not.be.reverted;
        //showBody(`stealing ${s.Dave_USDC} to dave from ${s.usdcAddress}`);
        await expect(
            stealMoney(usdc_minter, s.Dave.address, s.usdcAddress, s.Dave_USDC)
        ).to.not.be.reverted;
        //showBody(`stealing ${s.Carol_UNI} to carol from ${s.uniAddress}`);
        await expect(
            stealMoney(uni_minter, s.Carol.address, s.uniAddress, s.Carol_UNI)
        ).to.not.be.reverted;
        //showBody(`stealing ${s.Gus_WBTC} to gus from ${s.wbtcAddress}`);
        await expect(
            stealMoney(wbtc_minter, s.Gus.address, s.wbtcAddress, s.Gus_WBTC)
        ).to.not.be.reverted;
        //showBody(`stealing ${s.Bob_WETH} weth to bob from ${s.wethAddress}`);
        await expect(
            stealMoney(weth_minter, s.Bob.address, s.wethAddress, s.Bob_WETH)
        ).to.not.be.reverted;
        //showBody(`stealing`,s.Bob_USDC,`usdc to bob from ${s.usdcAddress}`);
        await expect(
            stealMoney(usdc_minter, s.Bob.address, s.usdcAddress, s.Bob_USDC)
        ).to.not.be.reverted
        //showBody(`stealing ${s.Carol_ENS} ens to carol from ${s.ensAddress}`);
        await expect(
            stealMoney(ens_minter, s.Carol.address, s.ensAddress, s.Carol_ENS)
        ).to.not.be.reverted;
        //showBody(`stealing ${s.Carol_DYDX} dydx to carol from ${s.dydxAddress}`);
        await expect(
            stealMoney(dydx_minter, s.Carol.address, s.dydxAddress, s.Carol_DYDX)
        ).to.not.be.reverted;
        //showBody(`stealing ${s.Carol_AAVE} aave to carol from ${s.aaveAddress}`);
        await expect(
            stealMoney(aave_minter, s.Carol.address, s.aaveAddress, s.Carol_AAVE)
        ).to.not.be.reverted;
        //showBody(`stealing ${s.Carol_TRIBE} to carol from ${s.tribeAddress}`);
        await expect(
            stealMoney(tribe_minter, s.Carol.address, s.tribeAddress, s.Carol_TRIBE)
        ).to.not.be.reverted;
        await mineBlock();
    });
});
