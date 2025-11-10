import { createConfig } from "starknet-ponder";
import { coreAbi } from "./abis/coreAbi.js";

export default createConfig({
  chains: {
    starknet: {
      id: 1,
      rpc: process.env.PONDER_RPC_URL_1!,
    },
  },
  contracts: {
    EkuboCore: {
      chain: "starknet",
      abi: coreAbi,
      address: "0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b",
      startBlock: 100000,
      includeTransactionReceipts: false,
    },
  },
});
