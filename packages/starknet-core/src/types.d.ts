declare module "ponder:registry" {
  import type { Virtual } from "starknet-ponder";
  type config = typeof import("ponder:internal").config;
  type schema = typeof import("ponder:internal").schema;

  export const ponder: Virtual.Registry<config["default"], schema>;

  export type EventNames = Virtual.EventNames<config["default"]>;
  export type Event<name extends EventNames = EventNames> = Virtual.Event<
    config["default"],
    name
  >;
  export type Context<name extends EventNames = EventNames> = Virtual.Context<
    config["default"],
    schema,
    name
  >;
  export type IndexingFunctionArgs<name extends EventNames = EventNames> =
    Virtual.IndexingFunctionArgs<config["default"], schema, name>;
}

declare module "ponder:schema" {
  const schema: typeof import("ponder:internal").schema;
  export { schema as default };
}

declare module "ponder:api" {
  import type { ReadonlyDrizzle, ReadonlyClient } from "starknet-ponder";

  type schema = typeof import("ponder:internal").schema;
  type config = typeof import("ponder:internal").config;

  export const db: ReadonlyDrizzle<schema>;

  // NOTE: Using ReadonlyClient instead of starkweb's PublicClient for proper type inference.
  // ReadonlyClient wraps the client with PonderActions which have better TypeScript inference
  // for readContract/readContracts return types. Without this, return types would be 'any'.
  // See: packages/starknet-core/src/indexing/client.ts for ReadonlyClient and PonderActions definitions.
  export const publicClients: {
    [chainName in keyof config["default"]["chains"]]: ReadonlyClient;
  };
}
