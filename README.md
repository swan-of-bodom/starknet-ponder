# Ponder for Starknet

> [!WARNING]
> This project is a **work in progress** and not yet ready for production use.
>
> **TODO:**
> - [ ] Publish packages to npm
> - [ ] Update starknet templates to use latest versions and new tooling (starknet.js)
> - [ ] Factory contracts support pending [starknet-specs#351](https://github.com/starkware-libs/starknet-specs/pull/351) — `starknet_getEvents` currently only allows 1 address, making child contract indexing inefficient

[![License][license-badge]][license-url]

> A fork of [Ponder](https://github.com/ponder-sh/ponder) adapted for the Starknet ecosystem.

**Forked from:** [ponder-sh/ponder](https://github.com/ponder-sh/ponder) at version [`0.14.13`](https://ponder.sh/docs/0.14/get-started)

Ponder is an open-source framework for blockchain application backends. This fork extends Ponder to support **Starknet**, enabling developers to build indexers and backends for Starknet-based applications.

## What's Different

This fork intends to be as close as possible to the original EVM Ponder. The main difference comes from using [starknet.js](https://www.starknetjs.com/) client instead of `viem`, but UX remains mostly unchanged.

## Packages Added

All packages left as original, except for 2 newly starknet only packages:

| Package | Description |
|---------|-------------|
| `starknet-ponder` | Core Starknet indexing framework |
| `create-ponder-starknet` | CLI tool to bootstrap Starknet indexer projects |

## Quickstart (Starknet)

### 1. Create a new project

```bash
npm init ponder-starknet@latest
# or
pnpm create ponder-starknet
# or
yarn create ponder-starknet
```

### 2. Start the development server

```bash
cd your-project
pnpm dev
```

### 3. Configure your contracts

```ts
// ponder.config.ts
import { createConfig } from "starknet-ponder";
import { MyContractAbi } from "./abis/MyContract";

export default createConfig({
  chains: {
    starknet: {
      id: 1, // SN_MAIN
      rpc: process.env.STARKNET_RPC_URL,
    },
  },
  contracts: {
    MyContract: {
      abi: MyContractAbi,
      chain: "starknet",
      address: "0x...",
      startBlock: 0,
    },
  },
});
```

### 4. Define your schema

```ts
// ponder.schema.ts
import { onchainTable } from "starknet-ponder";

export const transfers = onchainTable("transfers", (t) => ({
  id: t.text().primaryKey(),
  from: t.text().notNull(),
  to: t.text().notNull(),
  amount: t.bigint().notNull(),
}));
```

### 5. Write indexing functions

```ts
// src/MyContract.ts
import { ponder } from "ponder:registry";
import schema from "ponder:schema";

ponder.on("MyContract:Transfer", async ({ event, context }) => {
  await context.db.insert(schema.transfers).values({
    id: event.transactionHash,
    from: event.args.from,
    to: event.args.to,
    amount: event.args.amount,
  });
});
```

### 6. Query the GraphQL API

The auto-generated GraphQL API is available at `http://localhost:42069/graphql` during development.

## Original Ponder

For EVM-based chains (Ethereum, Polygon, Arbitrum, etc.), use the original `ponder` npm package. The original functionality is fully preserved in this fork but for the time being you're better off using the original ponder. Main reason we kept `/core` here is if one day we implement EVM + Starknet indexing in the same package.

Visit [ponder.sh](https://ponder.sh) for the original Ponder documentation.

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

For issues specific to the Starknet implementation, please open them in this repository. For issues with the core Ponder framework, consider contributing to the [upstream repository](https://github.com/ponder-sh/ponder).

## Acknowledgments

This project is built on top of [Ponder](https://github.com/ponder-sh/ponder) by [Cantrip, Inc.](https://github.com/ponder-sh). We are grateful for their excellent work on the original framework.

## License

MIT License - see [LICENSE](./LICENSE) for details.

Copyright (c) 2023 Cantrip, Inc.
Copyright (c) 2025 swan-of-bodom

[license-badge]: https://img.shields.io/badge/license-MIT-blue.svg
[license-url]: https://github.com/swan-of-bodom/ponder-starknet/blob/main/LICENSE
