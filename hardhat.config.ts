import "@nomiclabs/hardhat-ethers"
import "@nomiclabs/hardhat-waffle"
import * as dotenv from "dotenv"
import "hardhat-gas-reporter"
import "hardhat-dependency-compiler"
import { HardhatUserConfig } from "hardhat/config"
import "./tasks/deploy"

dotenv.config()

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
    solidity: "0.8.4",
    dependencyCompiler: {
        paths: ["@appliedzkp/semaphore-contracts/base/Verifier.sol"]
    },
    /*networks: {
        testnet: {
            url: `${process.env.HMY_TESTNET_RPC_URL}`,
            accounts: [`0x${process.env.HMY_PRIVATE_KEY}`]
        },
        mainnet: {
            url: `${process.env.HMY_MAINNET_RPC_URL}`,
            accounts: [`0x${process.env.HMY_PRIVATE_KEY_MAINNET}`]
        }
    },*/
    gasReporter: {
        enabled: process.env.REPORT_GAS !== undefined,
        currency: "USD"
    }
}

export default config
