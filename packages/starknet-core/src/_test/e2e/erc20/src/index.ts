declare const ponder: import("@/index.js").Virtual.Registry<
  typeof import("../ponder.config.js").default,
  typeof import("../ponder.schema.js")
>;

declare const schema: typeof import("../ponder.schema.js");

// @ts-ignore
// biome-ignore lint/suspicious/noRedeclare: <explanation>
import { ponder } from "ponder:registry";
// @ts-ignore
// biome-ignore lint/suspicious/noRedeclare: <explanation>
import schema from "ponder:schema";

// Cairo ERC20 Transfer event (src::strk::erc20_lockable::ERC20Lockable::Transfer)
// Members: from, to, value (all ContractAddress/u256)
ponder.on(
  "Erc20:Transfer",
  async ({ event, context }) => {
    await context.db
      .insert(schema.account)
      .values({
        address: event.args.from,
        balance: -event.args.value,
      })
      .onConflictDoUpdate((row) => ({
        balance: row.balance - event.args.value,
      }));

    await context.db
      .insert(schema.account)
      .values({
        address: event.args.to,
        balance: event.args.value,
      })
      .onConflictDoUpdate((row) => ({
        balance: row.balance + event.args.value,
      }));
  },
);
