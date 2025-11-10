import { createConfig } from "starknet-ponder";
import { erc20ABI } from "./abis/erc20ABI.js";

export default createConfig({
  chains: {
    starknet: {
      id: 1,
      rpc: process.env.PONDER_RPC_URL_1!,
    },
  },
  contracts: {
    Token: {
      chain: "starknet",
      abi: erc20ABI,
      address: "0x0124aeb495b947201f5fac96fd1138e326ad86195b98df6dec9009158a533b49",
      startBlock: 88597,
      includeTransactionReceipts: false,
    },
  },
});
