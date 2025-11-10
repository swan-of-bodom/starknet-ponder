import { createConfig } from "starknet-ponder";
import { forwarderABI } from "./abis/forwarderABI.js";

export default createConfig({
  chains: {
    starknet: {
      id: 1,
      rpc: process.env.PONDER_RPC_URL_1!,
    },
  },
  contracts: {
    Forwarder: {
      chain: "starknet",
      abi: forwarderABI,
      address: "0x0127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f",
      startBlock: 310000,
      includeTransactionReceipts: true,
    },
  },
});
