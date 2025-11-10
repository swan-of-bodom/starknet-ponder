import { createConfig } from "../../../config/index.js";
import { erc20ABI } from "../../generated.js";
import { STRK_TOKEN_ADDRESS, getDevnetUrl } from "../../utils.js";

const poolId = Number(process.env.VITEST_POOL_ID ?? 1);

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
    Erc20: {
      chain: "mainnet",
      abi: erc20ABI,
      // Use STRK token address (standard predeployed ERC20 on Starknet)
      address: STRK_TOKEN_ADDRESS,
    },
  },
});
