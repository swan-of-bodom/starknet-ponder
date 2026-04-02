import { ponder } from "ponder:registry";
import schema from "ponder:schema";
import { erc20ABI } from "../abis/erc20ABI";
import { CairoFelt252 } from "starknet";

ponder.on("EkuboCore:PoolInitialized", async ({ event, context }) => {
  const { pool_key, initial_tick, sqrt_ratio } = event.args;

  const [name0, symbol0, decimals0, name1, symbol1, decimals1] = await context.client.readContracts({
    contracts: [
      { address: pool_key.token0, abi: erc20ABI, functionName: "name" },
      { address: pool_key.token0, abi: erc20ABI, functionName: "symbol" },
      { address: pool_key.token0, abi: erc20ABI, functionName: "decimals" },
      { address: pool_key.token1, abi: erc20ABI, functionName: "name" },
      { address: pool_key.token1, abi: erc20ABI, functionName: "symbol" },
      { address: pool_key.token1, abi: erc20ABI, functionName: "decimals" },
    ]
  })

  await context.db.insert(schema.token).values({
    id: pool_key.token0,
    name: new CairoFelt252(name0.result!).decodeUtf8(),
    symbol: new CairoFelt252(symbol0.result!).decodeUtf8(),
    decimals: Number(decimals0.result),
  }).onConflictDoNothing();


  await context.db.insert(schema.token).values({
    id: pool_key.token1,
    name: new CairoFelt252(name1.result!).decodeUtf8(),
    symbol: new CairoFelt252(symbol1.result!).decodeUtf8(),
    decimals: Number(decimals1.result),
  }).onConflictDoNothing();
})


ponder.on("EkuboCore:ProtocolFeesPaid", async ({ context, event}) => {
  //console.log("Protocl Fees Paid")
})

ponder.on("EkuboCore:PositionUpdated", async ({ context, event}) => {
  //console.log("Position updated")
})

ponder.on("EkuboCore:PositionFeesCollected", async ({ context, event}) => {
  //console.log("Position fees Collected")
})

ponder.on("EkuboCore:ClassHashReplaced", async ({ context, event}) => {
  //console.log("Class Hash replaced")
})

ponder.on("EkuboCore:Swapped", async ({ context, event }) => {
  //console.log("Swapped")
})


