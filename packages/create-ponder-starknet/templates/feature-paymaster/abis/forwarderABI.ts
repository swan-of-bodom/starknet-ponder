/**
 * AVNU Forwarder (Paymaster) ABI:
 *
 * Mainnet: 0x0127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f
 * https://starkscan.co/contract/0x0127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f
 */
export const forwarderABI = [
  {
    name: "ForwarderImpl",
    type: "impl",
    interface_name: "avnu::forwarder::IForwarder",
  },
  {
    name: "core::bool",
    type: "enum",
    variants: [
      {
        name: "False",
        type: "()",
      },
      {
        name: "True",
        type: "()",
      },
    ],
  },
  {
    name: "core::integer::u256",
    type: "struct",
    members: [
      {
        name: "low",
        type: "core::integer::u128",
      },
      {
        name: "high",
        type: "core::integer::u128",
      },
    ],
  },
  {
    name: "avnu::forwarder::IForwarder",
    type: "interface",
    items: [
      {
        name: "get_gas_fees_recipient",
        type: "function",
        inputs: [],
        outputs: [
          {
            type: "core::starknet::contract_address::ContractAddress",
          },
        ],
        state_mutability: "view",
      },
      {
        name: "set_gas_fees_recipient",
        type: "function",
        inputs: [
          {
            name: "gas_fees_recipient",
            type: "core::starknet::contract_address::ContractAddress",
          },
        ],
        outputs: [
          {
            type: "core::bool",
          },
        ],
        state_mutability: "external",
      },
      {
        name: "execute",
        type: "function",
        inputs: [
          {
            name: "account_address",
            type: "core::starknet::contract_address::ContractAddress",
          },
          {
            name: "entrypoint",
            type: "core::felt252",
          },
          {
            name: "calldata",
            type: "core::array::Array::<core::felt252>",
          },
          {
            name: "gas_token_address",
            type: "core::starknet::contract_address::ContractAddress",
          },
          {
            name: "gas_amount",
            type: "core::integer::u256",
          },
        ],
        outputs: [
          {
            type: "core::bool",
          },
        ],
        state_mutability: "external",
      },
      {
        name: "execute_no_fee",
        type: "function",
        inputs: [
          {
            name: "account_address",
            type: "core::starknet::contract_address::ContractAddress",
          },
          {
            name: "entrypoint",
            type: "core::felt252",
          },
          {
            name: "calldata",
            type: "core::array::Array::<core::felt252>",
          },
        ],
        outputs: [
          {
            type: "core::bool",
          },
        ],
        state_mutability: "external",
      },
      {
        name: "execute_sponsored",
        type: "function",
        inputs: [
          {
            name: "account_address",
            type: "core::starknet::contract_address::ContractAddress",
          },
          {
            name: "entrypoint",
            type: "core::felt252",
          },
          {
            name: "calldata",
            type: "core::array::Array::<core::felt252>",
          },
          {
            name: "sponsor_metadata",
            type: "core::array::Array::<core::felt252>",
          },
        ],
        outputs: [
          {
            type: "core::bool",
          },
        ],
        state_mutability: "external",
      },
    ],
  },
  {
    name: "OwnableImpl",
    type: "impl",
    interface_name: "avnu_lib::components::ownable::IOwnable",
  },
  {
    name: "avnu_lib::components::ownable::IOwnable",
    type: "interface",
    items: [
      {
        name: "get_owner",
        type: "function",
        inputs: [],
        outputs: [
          {
            type: "core::starknet::contract_address::ContractAddress",
          },
        ],
        state_mutability: "view",
      },
      {
        name: "transfer_ownership",
        type: "function",
        inputs: [
          {
            name: "new_owner",
            type: "core::starknet::contract_address::ContractAddress",
          },
        ],
        outputs: [],
        state_mutability: "external",
      },
    ],
  },
  {
    name: "UpgradableImpl",
    type: "impl",
    interface_name: "avnu_lib::components::upgradable::IUpgradable",
  },
  {
    name: "avnu_lib::components::upgradable::IUpgradable",
    type: "interface",
    items: [
      {
        name: "upgrade_class",
        type: "function",
        inputs: [
          {
            name: "new_class_hash",
            type: "core::starknet::class_hash::ClassHash",
          },
        ],
        outputs: [],
        state_mutability: "external",
      },
    ],
  },
  {
    name: "WhitelistImpl",
    type: "impl",
    interface_name: "avnu_lib::components::whitelist::IWhitelist",
  },
  {
    name: "avnu_lib::components::whitelist::IWhitelist",
    type: "interface",
    items: [
      {
        name: "is_whitelisted",
        type: "function",
        inputs: [
          {
            name: "address",
            type: "core::starknet::contract_address::ContractAddress",
          },
        ],
        outputs: [
          {
            type: "core::bool",
          },
        ],
        state_mutability: "view",
      },
      {
        name: "set_whitelisted_address",
        type: "function",
        inputs: [
          {
            name: "address",
            type: "core::starknet::contract_address::ContractAddress",
          },
          {
            name: "value",
            type: "core::bool",
          },
        ],
        outputs: [
          {
            type: "core::bool",
          },
        ],
        state_mutability: "external",
      },
    ],
  },
  {
    name: "constructor",
    type: "constructor",
    inputs: [
      {
        name: "owner",
        type: "core::starknet::contract_address::ContractAddress",
      },
      {
        name: "gas_fees_recipient",
        type: "core::starknet::contract_address::ContractAddress",
      },
    ],
  },
  {
    kind: "struct",
    name: "avnu_lib::components::ownable::OwnableComponent::OwnershipTransferred",
    type: "event",
    members: [
      {
        kind: "key",
        name: "previous_owner",
        type: "core::starknet::contract_address::ContractAddress",
      },
      {
        kind: "key",
        name: "new_owner",
        type: "core::starknet::contract_address::ContractAddress",
      },
    ],
  },
  {
    kind: "enum",
    name: "avnu_lib::components::ownable::OwnableComponent::Event",
    type: "event",
    variants: [
      {
        kind: "nested",
        name: "OwnershipTransferred",
        type: "avnu_lib::components::ownable::OwnableComponent::OwnershipTransferred",
      },
    ],
  },
  {
    kind: "struct",
    name: "avnu_lib::components::upgradable::UpgradableComponent::Upgraded",
    type: "event",
    members: [
      {
        kind: "data",
        name: "class_hash",
        type: "core::starknet::class_hash::ClassHash",
      },
    ],
  },
  {
    kind: "enum",
    name: "avnu_lib::components::upgradable::UpgradableComponent::Event",
    type: "event",
    variants: [
      {
        kind: "nested",
        name: "Upgraded",
        type: "avnu_lib::components::upgradable::UpgradableComponent::Upgraded",
      },
    ],
  },
  {
    kind: "enum",
    name: "avnu_lib::components::whitelist::WhitelistComponent::Event",
    type: "event",
    variants: [],
  },
  {
    kind: "struct",
    name: "avnu::forwarder::Forwarder::SponsoredTransaction",
    type: "event",
    members: [
      {
        kind: "data",
        name: "user_address",
        type: "core::starknet::contract_address::ContractAddress",
      },
      {
        kind: "data",
        name: "sponsor_metadata",
        type: "core::array::Array::<core::felt252>",
      },
    ],
  },
  {
    kind: "enum",
    name: "avnu::forwarder::Forwarder::Event",
    type: "event",
    variants: [
      {
        kind: "flat",
        name: "OwnableEvent",
        type: "avnu_lib::components::ownable::OwnableComponent::Event",
      },
      {
        kind: "flat",
        name: "UpgradableEvent",
        type: "avnu_lib::components::upgradable::UpgradableComponent::Event",
      },
      {
        kind: "flat",
        name: "WhitelistEvent",
        type: "avnu_lib::components::whitelist::WhitelistComponent::Event",
      },
      {
        kind: "nested",
        name: "SponsoredTransaction",
        type: "avnu::forwarder::Forwarder::SponsoredTransaction",
      },
    ],
  },
] as const;
