import { ponder } from "ponder:registry";
import schema from "ponder:schema";

ponder.on("Factory:PoolCreated", async ({ event, context }) => {
  const { token0, token1, fee, tick_spacing, pool } = event.args;

  await context.db
    .insert(schema.pool)
    .values({
      id: pool,
      token0,
      token1,
      fee: fee,
      tickSpacing: tick_spacing,
      createdAtBlock: event.block.number,
      createdAtTimestamp: event.block.timestamp,
      createdTxHash: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on("Pool:Swap", async ({ event, context }) => {
  const { sender, recipient, amount0, amount1, sqrt_price_X96, liquidity, tick } = event.args;
  
  await context.db
    .insert(schema.swap)
    .values({
      id: event.id,
      poolAddress: event.log.address,
      sender,
      recipient,
      amount0: amount0.mag.toString(),
      amount1: amount1.mag.toString(),
      sqrtPriceX96: sqrt_price_X96.toString(),
      liquidity: liquidity.toString(),
      tick: tick.mag,
    })
    .onConflictDoNothing();
});
