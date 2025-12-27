import { createConfig, factory, parseStarknetAbiItem } from "starknet-ponder";
import { factoryAbi } from "./abis/factoryAbi.js";
import { poolAbi } from "./abis/poolAbi.js";

const PoolCreatedEvent = parseStarknetAbiItem(
  "event PoolCreated(ContractAddress token0, ContractAddress token1, u32 fee, u32 tick_spacing, ContractAddress pool)"
);

export default createConfig({
  chains: {
    starknet: {
      id: 1,
      rpc: process.env.PONDER_RPC_URL_1!,
    },
  },
  contracts: {
    Factory: {
      chain: "starknet",
      abi: factoryAbi,
      address: "0x01aa950c9b974294787de8df8880ecf668840a6ab8fa8290bf2952212b375148",
      startBlock: 637881,
      includeTransactionReceipts: false,
    },
    Pool: {
      chain: "starknet",
      abi: poolAbi,
      address: factory({
        address: "0x01aa950c9b974294787de8df8880ecf668840a6ab8fa8290bf2952212b375148",
        event: PoolCreatedEvent,
        parameter: "pool",
      }),
      startBlock: 637881,
      includeTransactionReceipts: false,
    },
  },
});
