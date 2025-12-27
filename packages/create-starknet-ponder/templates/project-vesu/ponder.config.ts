import { createConfig } from "starknet-ponder";
import { PoolFactoryAbi } from "./abis/PoolFactoryAbi.js";

export default createConfig({
  chains: {
    starknet: {
      id: 1,
      rpc: process.env.PONDER_RPC_URL_1!,
    },
  },
  contracts: {
    PoolFactory: {
      chain: "starknet",
      abi: PoolFactoryAbi,
      address: "0x3760f903a37948f97302736f89ce30290e45f441559325026842b7a6fb388c0",
      startBlock: 0,
      includeTransactionReceipts: false,
    },
  },
});
