# @ponder/core-starknet

Ponder for Starknet - An open-source framework for indexing Starknet smart contracts.

This is a fork of [Ponder](https://ponder.sh) adapted for Starknet, maintaining the same developer experience while supporting Starknet's unique features.

## Status

🚧 **Work in Progress** - This package is under active development.

## Key Differences from EVM Ponder

| Feature | EVM Ponder | Starknet Ponder |
|---------|------------|-----------------|
| **RPC Client** | viem | starknet.js |
| **Event Method** | `eth_getLogs` | `starknet_getEvents` |
| **Bloom Filters** | Supported (90-99% optimization) | Not available |
| **Pagination** | Block ranges | Continuation tokens |
| **Contract Config** | ABIs | Event selectors |
| **Address Format** | 0x... (20 bytes) | 0x... (felt252) |
| **Event Structure** | `topics` + `data` | `keys` + `data[]` |

## Installation

```bash
pnpm add @ponder/core-starknet starknet
```

## Usage

```typescript
import { createConfig } from "@ponder/core-starknet";

export default createConfig({
  chains: {
    starknet: {
      chainId: "SN_MAIN",
      rpc: "https://starknet-mainnet.g.alchemy.com/...",
    },
  },
  contracts: {
    USDC: {
      network: "starknet",
      address: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
      startBlock: 100000,
      events: {
        Transfer: "0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9",
      },
    },
  },
});
```

## Architecture

This package mirrors the structure of `@ponder/core` with Starknet-specific adaptations:

- **RPC Layer** (`src/rpc/`): Uses `starknet.js` RpcProvider instead of viem
- **Sync Layer** (`src/sync-realtime/`): Adapted for `starknet_getEvents` with continuation token pagination
- **Config** (`src/config/`): Starknet chain IDs and event selectors
- **Types** (`src/internal/`): Starknet-specific types (Felt252, event structure)

## Development

```bash
# Build
pnpm build

# Test
pnpm test

# Type check
pnpm typecheck
```

## Documentation

- [Ponder Docs](https://ponder.sh/docs) - General concepts apply
- [Starknet.js](https://www.starknetjs.com/) - RPC client documentation
- [Starknet Book](https://book.starknet.io/) - Starknet fundamentals

## License

MIT
