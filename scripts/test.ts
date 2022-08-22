import { getContractFactory } from "@nomiclabs/hardhat-ethers/types";
import { BN } from "../util/number";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Deployment, DeploymentInfo } from "./deployment/deployment";
import {
    CurveMaster__factory,
    OracleMaster__factory,
    ThreeLines0_100__factory,
    UniswapV3OracleRelay__factory,
    VaultController__factory,
    CappedGovToken__factory,
    IOracleRelay__factory
} from "../typechain-types";
import { utils, BigNumber } from "ethers";

import MerkleTree from "merkletreejs";
import { keccak256, solidityKeccak256 } from "ethers/lib/utils";
import { showBody } from "../util/format";
import { reset, currentBlock } from "../util/block"
import { stealMoney } from "../util/money"
import exp from "constants";
import { expect } from "chai";

const { ethers, network, upgrades } = require("hardhat");

async function main() {


    const accounts = await ethers.getSigners();

    const deployer = accounts[0];

    const net = ethers.provider._network

    console.log("net", net)

    if (net == 31337) {
        console.log("NETWORK: LOCAL")
        await reset(15367344)
        await network.provider.send("evm_setAutomine", [true])
    }

    /**
     const MATIC_ADDR = "0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0"
    const MATIC_WHALE = "0xf977814e90da44bfa03b6295a0616a897441acec"



    for(let i=0; i<accounts.length; i++){
        await stealMoney(MATIC_WHALE, accounts[i].address, MATIC_ADDR, BN("5000e18"))
    }


    const cappedMattic = CappedGovToken__factory.connect("0x5aC39Ed42e14Cf330A864d7D1B82690B4D1B9E61", deployer)
    const underlying = await cappedMattic._underlying()

    if( underlying.toUpperCase() != MATIC_ADDR.toUpperCase()){
        console.log(">>>>>ERROR<<<<<<")
        console.log("UNDERLYING != MATIC")
    }
     */


    const expected = {
        Lookback: 14400,
        Pool: "0x07A6E955bA4345BAe83Ac2A6fAa771fddd8A2011",
        quote_token_is_token0: false,
        mul: 1000000000000,
        div: 1
    }

    if (network == 1 || network == 31337) {
        const contractAddr = "0xfE1cb3221f13A9c2AA67D29a2b7198e59de2F3b2"

        const relay = UniswapV3OracleRelay__factory.connect(contractAddr, deployer)

        console.log("Reading Original Params")
        const lookback = await relay._lookback()
        console.log("Lookback: ", lookback)
        const Pool = await relay._pool()
        console.log("Pool: ", Pool)
        const quote_token_is_token0 = await relay._quoteTokenIsToken0()
        console.log("quote_token_is_token0: ", quote_token_is_token0)
        const mul = await relay._mul()
        console.log("mul: ", mul.toNumber())
        const div = await relay._div()
        console.log("div: ", div.toNumber())

        if (lookback == expected.Lookback && Pool == expected.Pool && quote_token_is_token0 == expected.quote_token_is_token0 && mul.toNumber() == expected.mul && div.toNumber() == expected.div) {
            console.log("MATCH")
        }else{
            console.log("MISMATCH")
        }
    }




    const factory = await ethers.getContractFactory("UniswapV3OracleRelay")
    const newRelay = await factory.deploy(expected.Lookback, expected.Pool, expected.quote_token_is_token0, expected.mul, expected.div)
    await newRelay.deployed()

    console.log("New relay deployed with the above params to: ", newRelay.address)

    /**
     hh verify 0x17388E51Cc7aC57dA91a74e878b576b245D23d21 14400, 0x07A6E955bA4345BAe83Ac2A6fAa771fddd8A2011, false, 1000000000000, 1
     */



}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
