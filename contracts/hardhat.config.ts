import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  test: {
    solidity: {
      fuzz: {
        runs: 256,
      },
      invariant: {
        runs: 64,
        depth: 64,
        failOnRevert: false,
      },
    },
  },
  coverage: {
    skipFiles: ["contracts/**/*.t.sol", "contracts/test/**/*.sol"],
  },
  verify: {
    etherscan: {
      apiKey: configVariable("ETHERSCAN_API_KEY"),
    },
    sourcify: {
      enabled: true,
    },
  },
  networks: {
    localhost: {
      type: "http",
      chainType: "l1",
      url: process.env.LOCALHOST_RPC_URL ?? "http://127.0.0.1:8545",
      chainId: 31337,
    },
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
      chainId: 11155111,
    },
    baseSepolia: {
      type: "http",
      chainType: "op",
      url: configVariable("BASE_SEPOLIA_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
      chainId: 84532,
    },
    bscTestnet: {
      type: "http",
      chainType: "l1",
      url: configVariable("BSC_TESTNET_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
      chainId: 97,
    },
  },
});
