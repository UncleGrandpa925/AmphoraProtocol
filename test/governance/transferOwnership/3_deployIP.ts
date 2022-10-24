import { expect, assert } from "chai";
import { ethers, network, tenderly } from "hardhat";
import { stealMoney } from "../../../util/money";
import { showBody } from "../../../util/format";
import { BN } from "../../../util/number";
import { s } from ".././scope";
import { advanceBlockHeight, reset, mineBlock } from "../../../util/block";
import {
    AnchoredViewRelay,
    AnchoredViewRelay__factory,
    ChainlinkOracleRelay,
    ChainlinkOracleRelay__factory,
    CurveMaster,
    CurveMaster__factory,
    IERC20,
    IERC20__factory,
    IOracleRelay,
    OracleMaster,
    OracleMaster__factory,
    ProxyAdmin,
    ProxyAdmin__factory,
    TransparentUpgradeableProxy__factory,
    ThreeLines0_100,
    ThreeLines0_100__factory,
    UniswapV3OracleRelay__factory,
    USDA,
    USDA__factory,
    Vault,
    VaultController,
    VaultController__factory,
    IVOTE,
    IVOTE__factory,
} from "../../../typechain-types";
import { DeployContract, DeployContractWithProxy } from "../../../util/deploy";




const deployProxy = async () => {
    s.ProxyAdmin = await DeployContract(
        new ProxyAdmin__factory(s.Frank),
        s.Frank
    );
    await mineBlock();
    s.VaultController = await DeployContractWithProxy(
        new VaultController__factory(s.Frank),
        s.Frank,
        s.ProxyAdmin
    );
    await mineBlock();
    s.USDA = await DeployContractWithProxy(
        new USDA__factory(s.Frank),
        s.Frank,
        s.ProxyAdmin,
        s.usdcAddress
    );
    await mineBlock();

    await expect(s.USDA.setVaultController(s.VaultController.address)).to.not.reverted
    await mineBlock();
};

require("chai").should();
describe("Deploy Contracts", () => {
    before(async () => {
        await deployProxy();
    });
    it("Verify deployment of VaultController proxy", async () => {
        const protocolFee = await s.VaultController.connect(s.Andy).protocolFee();
        await mineBlock();
        const expectedProtocolFee = BN("1e14");
        assert.equal(
            protocolFee.toString(),
            expectedProtocolFee.toString(),
            "VaultController Initialized"
        );
    });
    it("Verify deployment of USDa proxy", async () => {
        const reserveAddress = await s.USDA.reserveAddress();
        await mineBlock();
        const expectedReserveAddress = s.usdcAddress;
        assert.equal(reserveAddress, expectedReserveAddress, "USDa Initialized");
    });
    describe("Sanity check USDa deploy", () => {
        it("Should return the right name, symbol, and decimals", async () => {
            expect(await s.USDA.name()).to.equal("USDA Token");
            expect(await s.USDA.symbol()).to.equal("USDA");
            expect(await s.USDA.decimals()).to.equal(18);
            expect(await s.USDA.owner()).to.equal(s.Frank.address);
        });
        it(`The burner address should have ${BN(
            "1e18"
        ).toLocaleString()} fragment`, async () => {
            expect(
                await s.USDA.balanceOf("0x0000000000000000000000000000000000000000")
            ).to.eq(BN("1e18"));
        });
        it(`the totalSupply should be ${BN("1e18").toLocaleString()}`, async () => {
            expect(await s.USDA.totalSupply()).to.eq(BN("1e18"));
        });
        it("the owner should be the Frank", async () => {
            expect(await s.USDA.owner()).to.eq(await s.Frank.getAddress());
        });
    });

    it("Deploy Curve", async () => {
        await mineBlock();
        s.ThreeLines = await DeployContract(
            new ThreeLines0_100__factory(s.Frank),
            s.Frank,
            BN("200e16"),
            BN("5e16"),
            BN("45e15"),
            BN("50e16"),
            BN("55e16")
        );
        await mineBlock();
        s.Curve = await DeployContract(new CurveMaster__factory(s.Frank), s.Frank);
        await mineBlock();
        await expect(s.VaultController.registerCurveMaster(s.Curve.address)).to.not
            .reverted;
        await mineBlock();
    });

    it("Deploy Oracles", async () => {
        s.Oracle = await DeployContract(
            new OracleMaster__factory(s.Frank),
            s.Frank
        );
        //showBody("set vault oraclemaster")
        await expect(
            s.VaultController.connect(s.Frank).registerOracleMaster(s.Oracle.address)
        ).to.not.reverted;

        //showBody("create uniswap wbtc relay")
        s.UniswapRelayWbtcUsdc = await DeployContract(
            new UniswapV3OracleRelay__factory(s.Frank),
            s.Frank,
            60,
            s.usdcWbtcPool,
            false,
            BN("1e12"),
            BN("1")
        );
        await mineBlock();
        expect(await s.UniswapRelayWbtcUsdc.currentValue()).to.not.eq(0);

        //showBody("create uniswap eth relay")
        s.UniswapRelayEthUsdc = await DeployContract(
            new UniswapV3OracleRelay__factory(s.Frank),
            s.Frank,
            60,
            s.usdcWethPool,
            true,
            BN("1e12"),
            BN("1")
        );
        await mineBlock();
        expect(await s.UniswapRelayEthUsdc.currentValue()).to.not.eq(0);

        //showBody("create uniswap uni relay")
        s.UniswapRelayUniUsdc = await DeployContract(
            new UniswapV3OracleRelay__factory(s.Frank),
            s.Frank,
            60,
            s.usdcUniPool,
            false,
            BN("1e12"),
            BN("1")
        );
        await mineBlock();
        expect(await s.UniswapRelayUniUsdc.currentValue()).to.not.eq(0);

        //showBody("create chainlink uni relay")
        s.ChainLinkUni = await DeployContract(
            new ChainlinkOracleRelay__factory(s.Frank),
            s.Frank,
            s.chainlinkUniFeed,
            BN("1e10"),
            BN("1")
        );
        await mineBlock();
        expect(await s.ChainLinkUni.currentValue()).to.not.eq(0);

        //showBody("create chainlink btc relay")
        s.ChainLinkBtc = await DeployContract(
            new ChainlinkOracleRelay__factory(s.Frank),
            s.Frank,
            s.chainlinkBtcFeed,
            BN("1e20"),
            BN("1")
        );
        await mineBlock();
        expect(await s.ChainLinkBtc.currentValue()).to.not.eq(0);

        //showBody("create chainlink eth relay")
        s.ChainlinkEth = await DeployContract(
            new ChainlinkOracleRelay__factory(s.Frank),
            s.Frank,
            s.chainlinkEthFeed,
            BN("1e10"),
            BN("1")
        );
        await mineBlock();
        expect(await s.ChainlinkEth.currentValue()).to.not.eq(0);

        //showBody("create Uni anchoredview")
        s.AnchoredViewUni = await DeployContract(
            new AnchoredViewRelay__factory(s.Frank),
            s.Frank,
            s.UniswapRelayUniUsdc.address,
            s.ChainLinkUni.address,
            BN("30"),
            BN("100")
        );
        await mineBlock();
        expect(await s.AnchoredViewUni.currentValue()).to.not.eq(0);

        //showBody("create Btc anchoredview")
        s.AnchoredViewBtc = await DeployContract(
            new AnchoredViewRelay__factory(s.Frank),
            s.Frank,
            s.UniswapRelayWbtcUsdc.address,
            s.ChainLinkBtc.address,
            BN("30"),
            BN("100")
        );
        await mineBlock();
        expect(await s.AnchoredViewBtc.currentValue()).to.not.eq(0);

        //showBody("create ETH anchoredview")
        s.AnchoredViewEth = await DeployContract(
            new AnchoredViewRelay__factory(s.Frank),
            s.Frank,
            s.UniswapRelayEthUsdc.address,
            s.ChainlinkEth.address,
            BN("10"),
            BN("100")
        );
        await mineBlock();
        expect(await s.AnchoredViewEth.currentValue()).to.not.eq(0);
    });

    it("Set vault oracles and CFs", async () => {
        //showBody("set vault Uni oracle to anchored view")
        await expect(
            s.Oracle.connect(s.Frank).setRelay(
                s.uniAddress,
                s.AnchoredViewUni.address
            )
        ).to.not.reverted;

        //showBody("set vault Btc oracle to anchored view")
        await expect(
            s.Oracle.connect(s.Frank).setRelay(
                s.wbtcAddress,
                s.AnchoredViewBtc.address
            )
        ).to.not.reverted;

        //showBody("set vault ETH oracle to anchored view")
        await expect(
            s.Oracle.connect(s.Frank).setRelay(
                s.wethAddress,
                s.AnchoredViewEth.address
            )
        ).to.not.reverted;

        //showBody("register weth")
        await expect(
            s.VaultController.connect(s.Frank).registerErc20(
                s.wethAddress,
                s.wETH_LTV,
                s.wethAddress,
                s.LiquidationIncentive
            )
        ).to.not.reverted;
        //showBody("register Uni")
        await expect(
            s.VaultController.connect(s.Frank).registerErc20(
                s.uniAddress,
                s.UNI_LTV,
                s.uniAddress,
                s.LiquidationIncentive
            )
        ).to.not.reverted;
        //showBody("register WBTC")
        await expect(
            s.VaultController.connect(s.Frank).registerErc20(
                s.wbtcAddress,
                s.wBTC_LTV,
                s.wbtcAddress,
                s.LiquidationIncentive
            )
        ).to.not.reverted;
    });

    it("final setup", async () => {
        //showBody("register vaultcontroller USDa")
        await expect(
            s.VaultController.connect(s.Frank).registerUSDa(s.USDA.address)
        ).to.not.reverted;
        await mineBlock();

        //set pauser
        let pauser = await s.USDA.pauser()
        expect(pauser).to.eq("0x0000000000000000000000000000000000000000")
        await s.USDA.connect(s.Frank).setPauser(s.Frank.address)
        await mineBlock()
        pauser = await s.USDA.pauser()
        expect(pauser).to.eq(s.Frank.address)
    })
});
