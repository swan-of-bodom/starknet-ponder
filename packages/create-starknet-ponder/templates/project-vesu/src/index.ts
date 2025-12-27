import { ponder } from "ponder:registry";
import schema from "ponder:schema";
import { VTokenAbi } from "../abis/VTokenAbi";
import { decodeShortString } from "starkweb2/utils";

ponder.on("PoolFactory:CreateVToken", async ({ event, context }) => {
  // Insert VToken
  await context.db.insert(schema.vToken).values({
    id: event.args.v_token,
    pool: event.args.pool,
    asset: event.args.asset,
    name: event.args.v_token_name,
    symbol: event.args.v_token_symbol,
    createdAtBlock: event.block.number,
    createdAtTimestamp: event.block.timestamp,
    createdTxHash: event.transaction.hash,
  });

  // VTokenAbi to read asset metadata
  const contract = { address: event.args.asset, abi: VTokenAbi };
  const [name, symbol, decimals] = await context.client.readContracts({
    contracts: [
      { ...contract, functionName: "name" },
      { ...contract, functionName: "symbol" },
      { ...contract, functionName: "decimals" },
    ],
  });

  // Insert underlying asset
  await context.db
    .insert(schema.token)
    .values({
      id: event.args.asset,
      name: decodeShortString(name.data),
      symbol: decodeShortString(symbol.data),
      decimals: decimals.data,
    })
    .onConflictDoNothing();
});
