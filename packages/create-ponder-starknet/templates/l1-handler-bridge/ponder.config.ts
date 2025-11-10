import { createConfig } from "starknet-ponder";
import { wbtcBridgeABI } from "./abis/wbtcBridgeABI.js";

export default createConfig({
  chains: {
    starknet: {
      id: 1,
      rpc: process.env.PONDER_RPC_URL_1!,
    },
  },
  contracts: {
    WBTCBridge: {
      chain: "starknet",
      abi: wbtcBridgeABI,
      address: "0x07aeec4870975311a7396069033796b61cd66ed49d22a786cba12a8d76717302",
      startBlock: 0,
      includeTransactionReceipts: false,
    },
  },
});
