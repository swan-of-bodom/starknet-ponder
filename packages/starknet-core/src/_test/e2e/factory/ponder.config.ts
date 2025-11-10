import { factory } from "@/config/address.js";
import { createConfig } from "../../../config/index.js";
import { factoryABI, pairABI } from "../../generated.js";
import { getDevnetUrl } from "../../utils.js";

const poolId = Number(process.env.VITEST_POOL_ID ?? 1);

// Helper to get PairCreated event from Cairo ABI
const pairCreatedEvent = (factoryABI as readonly any[]).find(
  (item: any) => item.type === "event" && item.name === "PairCreated"
);

function getDatabase() {
  if (process.env.DATABASE_URL) {
    const databaseUrl = new URL(process.env.DATABASE_URL);
    databaseUrl.pathname = `/vitest_${poolId}`;
    const connectionString = databaseUrl.toString();
    return { kind: "postgres", connectionString } as const;
  } else {
    return { kind: "pglite" } as const;
  }
}

export default createConfig({
  database: getDatabase(),
  chains: {
    mainnet: {
      id: 1,
      rpc: getDevnetUrl(),
    },
  },
  contracts: {
    Pair: {
      chain: "mainnet",
      abi: pairABI,
      address: factory({
        // Mock factory address (66 chars for Starknet)
        address: "0x0000000000000000000000000000000000000000000000000000000000000001",
        event: pairCreatedEvent,
        parameter: "pair",
      }),
    },
  },
});
