/**
 * Vesu PoolFactory ABI
 *
 * https://starkscan.co/contract/0x3760f903a37948f97302736f89ce30290e45f441559325026842b7a6fb388c0#class-code-history
 * https://voyager.online/class/0x05041cc424410e1a63e4f3ef7d65ab3115f19eabb2d45418e7ac245df011d994
 */
export const PoolFactoryAbi = [
  {
    "name": "PoolFactoryImpl",
    "type": "impl",
    "interface_name": "vesu::pool_factory::IPoolFactory"
  },
  {
    "name": "core::byte_array::ByteArray",
    "type": "struct",
    "members": [
      {
        "name": "data",
        "type": "core::array::Array::<core::bytes_31::bytes31>"
      },
      {
        "name": "pending_word",
        "type": "core::felt252"
      },
      {
        "name": "pending_word_len",
        "type": "core::integer::u32"
      }
    ]
  },
  {
    "name": "core::integer::u256",
    "type": "struct",
    "members": [
      {
        "name": "low",
        "type": "core::integer::u128"
      },
      {
        "name": "high",
        "type": "core::integer::u128"
      }
    ]
  },
  {
    "name": "core::bool",
    "type": "enum",
    "variants": [
      {
        "name": "False",
        "type": "()"
      },
      {
        "name": "True",
        "type": "()"
      }
    ]
  },
  {
    "name": "vesu::data_model::AssetParams",
    "type": "struct",
    "members": [
      {
        "name": "asset",
        "type": "core::starknet::contract_address::ContractAddress"
      },
      {
        "name": "floor",
        "type": "core::integer::u256"
      },
      {
        "name": "initial_full_utilization_rate",
        "type": "core::integer::u256"
      },
      {
        "name": "max_utilization",
        "type": "core::integer::u256"
      },
      {
        "name": "is_legacy",
        "type": "core::bool"
      },
      {
        "name": "fee_rate",
        "type": "core::integer::u256"
      }
    ]
  },
  {
    "name": "core::array::Span::<vesu::data_model::AssetParams>",
    "type": "struct",
    "members": [
      {
        "name": "snapshot",
        "type": "@core::array::Array::<vesu::data_model::AssetParams>"
      }
    ]
  },
  {
    "name": "vesu::data_model::VTokenParams",
    "type": "struct",
    "members": [
      {
        "name": "v_token_name",
        "type": "core::byte_array::ByteArray"
      },
      {
        "name": "v_token_symbol",
        "type": "core::byte_array::ByteArray"
      },
      {
        "name": "debt_asset",
        "type": "core::starknet::contract_address::ContractAddress"
      }
    ]
  },
  {
    "name": "core::array::Span::<vesu::data_model::VTokenParams>",
    "type": "struct",
    "members": [
      {
        "name": "snapshot",
        "type": "@core::array::Array::<vesu::data_model::VTokenParams>"
      }
    ]
  },
  {
    "name": "vesu::interest_rate_model::InterestRateConfig",
    "type": "struct",
    "members": [
      {
        "name": "min_target_utilization",
        "type": "core::integer::u256"
      },
      {
        "name": "max_target_utilization",
        "type": "core::integer::u256"
      },
      {
        "name": "target_utilization",
        "type": "core::integer::u256"
      },
      {
        "name": "min_full_utilization_rate",
        "type": "core::integer::u256"
      },
      {
        "name": "max_full_utilization_rate",
        "type": "core::integer::u256"
      },
      {
        "name": "zero_utilization_rate",
        "type": "core::integer::u256"
      },
      {
        "name": "rate_half_life",
        "type": "core::integer::u256"
      },
      {
        "name": "target_rate_percent",
        "type": "core::integer::u256"
      }
    ]
  },
  {
    "name": "core::array::Span::<vesu::interest_rate_model::InterestRateConfig>",
    "type": "struct",
    "members": [
      {
        "name": "snapshot",
        "type": "@core::array::Array::<vesu::interest_rate_model::InterestRateConfig>"
      }
    ]
  },
  {
    "name": "vesu::data_model::PairParams",
    "type": "struct",
    "members": [
      {
        "name": "collateral_asset_index",
        "type": "core::integer::u32"
      },
      {
        "name": "debt_asset_index",
        "type": "core::integer::u32"
      },
      {
        "name": "max_ltv",
        "type": "core::integer::u64"
      },
      {
        "name": "liquidation_factor",
        "type": "core::integer::u64"
      },
      {
        "name": "debt_cap",
        "type": "core::integer::u128"
      }
    ]
  },
  {
    "name": "core::array::Span::<vesu::data_model::PairParams>",
    "type": "struct",
    "members": [
      {
        "name": "snapshot",
        "type": "@core::array::Array::<vesu::data_model::PairParams>"
      }
    ]
  },
  {
    "name": "core::array::Span::<core::felt252>",
    "type": "struct",
    "members": [
      {
        "name": "snapshot",
        "type": "@core::array::Array::<core::felt252>"
      }
    ]
  },
  {
    "name": "core::option::Option::<(core::starknet::class_hash::ClassHash, core::array::Span::<core::felt252>)>",
    "type": "enum",
    "variants": [
      {
        "name": "Some",
        "type": "(core::starknet::class_hash::ClassHash, core::array::Span::<core::felt252>)"
      },
      {
        "name": "None",
        "type": "()"
      }
    ]
  },
  {
    "name": "vesu::pool_factory::IPoolFactory",
    "type": "interface",
    "items": [
      {
        "name": "set_pool_class_hash",
        "type": "function",
        "inputs": [
          {
            "name": "pool_class_hash",
            "type": "core::felt252"
          }
        ],
        "outputs": [],
        "state_mutability": "external"
      },
      {
        "name": "pool_class_hash",
        "type": "function",
        "inputs": [],
        "outputs": [
          {
            "type": "core::felt252"
          }
        ],
        "state_mutability": "view"
      },
      {
        "name": "set_v_token_class_hash",
        "type": "function",
        "inputs": [
          {
            "name": "v_token_class_hash",
            "type": "core::felt252"
          }
        ],
        "outputs": [],
        "state_mutability": "external"
      },
      {
        "name": "v_token_class_hash",
        "type": "function",
        "inputs": [],
        "outputs": [
          {
            "type": "core::felt252"
          }
        ],
        "state_mutability": "view"
      },
      {
        "name": "set_oracle_class_hash",
        "type": "function",
        "inputs": [
          {
            "name": "oracle_class_hash",
            "type": "core::felt252"
          }
        ],
        "outputs": [],
        "state_mutability": "external"
      },
      {
        "name": "oracle_class_hash",
        "type": "function",
        "inputs": [],
        "outputs": [
          {
            "type": "core::felt252"
          }
        ],
        "state_mutability": "view"
      },
      {
        "name": "v_token_for_asset",
        "type": "function",
        "inputs": [
          {
            "name": "pool",
            "type": "core::starknet::contract_address::ContractAddress"
          },
          {
            "name": "asset",
            "type": "core::starknet::contract_address::ContractAddress"
          }
        ],
        "outputs": [
          {
            "type": "core::starknet::contract_address::ContractAddress"
          }
        ],
        "state_mutability": "view"
      },
      {
        "name": "asset_for_v_token",
        "type": "function",
        "inputs": [
          {
            "name": "pool",
            "type": "core::starknet::contract_address::ContractAddress"
          },
          {
            "name": "v_token",
            "type": "core::starknet::contract_address::ContractAddress"
          }
        ],
        "outputs": [
          {
            "type": "core::starknet::contract_address::ContractAddress"
          }
        ],
        "state_mutability": "view"
      },
      {
        "name": "update_v_token",
        "type": "function",
        "inputs": [
          {
            "name": "pool",
            "type": "core::starknet::contract_address::ContractAddress"
          },
          {
            "name": "asset",
            "type": "core::starknet::contract_address::ContractAddress"
          },
          {
            "name": "debt_asset",
            "type": "core::starknet::contract_address::ContractAddress"
          },
          {
            "name": "v_token_name",
            "type": "core::byte_array::ByteArray"
          },
          {
            "name": "v_token_symbol",
            "type": "core::byte_array::ByteArray"
          }
        ],
        "outputs": [],
        "state_mutability": "external"
      },
      {
        "name": "create_pool",
        "type": "function",
        "inputs": [
          {
            "name": "name",
            "type": "core::felt252"
          },
          {
            "name": "curator",
            "type": "core::starknet::contract_address::ContractAddress"
          },
          {
            "name": "oracle",
            "type": "core::starknet::contract_address::ContractAddress"
          },
          {
            "name": "fee_recipient",
            "type": "core::starknet::contract_address::ContractAddress"
          },
          {
            "name": "asset_params",
            "type": "core::array::Span::<vesu::data_model::AssetParams>"
          },
          {
            "name": "v_token_params",
            "type": "core::array::Span::<vesu::data_model::VTokenParams>"
          },
          {
            "name": "interest_rate_params",
            "type": "core::array::Span::<vesu::interest_rate_model::InterestRateConfig>"
          },
          {
            "name": "pair_params",
            "type": "core::array::Span::<vesu::data_model::PairParams>"
          }
        ],
        "outputs": [
          {
            "type": "core::starknet::contract_address::ContractAddress"
          }
        ],
        "state_mutability": "external"
      },
      {
        "name": "add_asset",
        "type": "function",
        "inputs": [
          {
            "name": "pool",
            "type": "core::starknet::contract_address::ContractAddress"
          },
          {
            "name": "asset",
            "type": "core::starknet::contract_address::ContractAddress"
          },
          {
            "name": "asset_params",
            "type": "vesu::data_model::AssetParams"
          },
          {
            "name": "interest_rate_config",
            "type": "vesu::interest_rate_model::InterestRateConfig"
          },
          {
            "name": "v_token_params",
            "type": "vesu::data_model::VTokenParams"
          }
        ],
        "outputs": [],
        "state_mutability": "external"
      },
      {
        "name": "create_oracle",
        "type": "function",
        "inputs": [
          {
            "name": "manager",
            "type": "core::starknet::contract_address::ContractAddress"
          },
          {
            "name": "pragma_oracle",
            "type": "core::starknet::contract_address::ContractAddress"
          },
          {
            "name": "pragma_summary",
            "type": "core::starknet::contract_address::ContractAddress"
          }
        ],
        "outputs": [
          {
            "type": "core::starknet::contract_address::ContractAddress"
          }
        ],
        "state_mutability": "external"
      },
      {
        "name": "upgrade_name",
        "type": "function",
        "inputs": [],
        "outputs": [
          {
            "type": "core::felt252"
          }
        ],
        "state_mutability": "view"
      },
      {
        "name": "upgrade",
        "type": "function",
        "inputs": [
          {
            "name": "new_implementation",
            "type": "core::starknet::class_hash::ClassHash"
          },
          {
            "name": "eic_implementation_data",
            "type": "core::option::Option::<(core::starknet::class_hash::ClassHash, core::array::Span::<core::felt252>)>"
          }
        ],
        "outputs": [],
        "state_mutability": "external"
      }
    ]
  },
  {
    "name": "OwnableTwoStepImpl",
    "type": "impl",
    "interface_name": "openzeppelin_access::ownable::interface::IOwnableTwoStep"
  },
  {
    "name": "openzeppelin_access::ownable::interface::IOwnableTwoStep",
    "type": "interface",
    "items": [
      {
        "name": "owner",
        "type": "function",
        "inputs": [],
        "outputs": [
          {
            "type": "core::starknet::contract_address::ContractAddress"
          }
        ],
        "state_mutability": "view"
      },
      {
        "name": "pending_owner",
        "type": "function",
        "inputs": [],
        "outputs": [
          {
            "type": "core::starknet::contract_address::ContractAddress"
          }
        ],
        "state_mutability": "view"
      },
      {
        "name": "accept_ownership",
        "type": "function",
        "inputs": [],
        "outputs": [],
        "state_mutability": "external"
      },
      {
        "name": "transfer_ownership",
        "type": "function",
        "inputs": [
          {
            "name": "new_owner",
            "type": "core::starknet::contract_address::ContractAddress"
          }
        ],
        "outputs": [],
        "state_mutability": "external"
      },
      {
        "name": "renounce_ownership",
        "type": "function",
        "inputs": [],
        "outputs": [],
        "state_mutability": "external"
      }
    ]
  },
  {
    "name": "constructor",
    "type": "constructor",
    "inputs": [
      {
        "name": "owner",
        "type": "core::starknet::contract_address::ContractAddress"
      },
      {
        "name": "pool_class_hash",
        "type": "core::felt252"
      },
      {
        "name": "v_token_class_hash",
        "type": "core::felt252"
      },
      {
        "name": "oracle_class_hash",
        "type": "core::felt252"
      }
    ]
  },
  {
    "kind": "struct",
    "name": "openzeppelin_access::ownable::ownable::OwnableComponent::OwnershipTransferred",
    "type": "event",
    "members": [
      {
        "kind": "key",
        "name": "previous_owner",
        "type": "core::starknet::contract_address::ContractAddress"
      },
      {
        "kind": "key",
        "name": "new_owner",
        "type": "core::starknet::contract_address::ContractAddress"
      }
    ]
  },
  {
    "kind": "struct",
    "name": "openzeppelin_access::ownable::ownable::OwnableComponent::OwnershipTransferStarted",
    "type": "event",
    "members": [
      {
        "kind": "key",
        "name": "previous_owner",
        "type": "core::starknet::contract_address::ContractAddress"
      },
      {
        "kind": "key",
        "name": "new_owner",
        "type": "core::starknet::contract_address::ContractAddress"
      }
    ]
  },
  {
    "kind": "enum",
    "name": "openzeppelin_access::ownable::ownable::OwnableComponent::Event",
    "type": "event",
    "variants": [
      {
        "kind": "nested",
        "name": "OwnershipTransferred",
        "type": "openzeppelin_access::ownable::ownable::OwnableComponent::OwnershipTransferred"
      },
      {
        "kind": "nested",
        "name": "OwnershipTransferStarted",
        "type": "openzeppelin_access::ownable::ownable::OwnableComponent::OwnershipTransferStarted"
      }
    ]
  },
  {
    "kind": "struct",
    "name": "vesu::pool_factory::PoolFactory::CreateVToken",
    "type": "event",
    "members": [
      {
        "kind": "key",
        "name": "pool",
        "type": "core::starknet::contract_address::ContractAddress"
      },
      {
        "kind": "key",
        "name": "asset",
        "type": "core::starknet::contract_address::ContractAddress"
      },
      {
        "kind": "key",
        "name": "v_token",
        "type": "core::starknet::contract_address::ContractAddress"
      },
      {
        "kind": "key",
        "name": "v_token_name",
        "type": "core::byte_array::ByteArray"
      },
      {
        "kind": "key",
        "name": "v_token_symbol",
        "type": "core::byte_array::ByteArray"
      }
    ]
  },
  {
    "kind": "struct",
    "name": "vesu::pool_factory::PoolFactory::UpdateVToken",
    "type": "event",
    "members": [
      {
        "kind": "key",
        "name": "pool",
        "type": "core::starknet::contract_address::ContractAddress"
      },
      {
        "kind": "key",
        "name": "asset",
        "type": "core::starknet::contract_address::ContractAddress"
      },
      {
        "kind": "key",
        "name": "prev_v_token",
        "type": "core::starknet::contract_address::ContractAddress"
      },
      {
        "kind": "key",
        "name": "new_v_token",
        "type": "core::starknet::contract_address::ContractAddress"
      }
    ]
  },
  {
    "kind": "struct",
    "name": "vesu::pool_factory::PoolFactory::CreatePool",
    "type": "event",
    "members": [
      {
        "kind": "key",
        "name": "pool",
        "type": "core::starknet::contract_address::ContractAddress"
      },
      {
        "kind": "key",
        "name": "name",
        "type": "core::felt252"
      },
      {
        "kind": "key",
        "name": "owner",
        "type": "core::starknet::contract_address::ContractAddress"
      },
      {
        "kind": "key",
        "name": "curator",
        "type": "core::starknet::contract_address::ContractAddress"
      },
      {
        "kind": "key",
        "name": "oracle",
        "type": "core::starknet::contract_address::ContractAddress"
      }
    ]
  },
  {
    "kind": "struct",
    "name": "vesu::pool_factory::PoolFactory::AddAsset",
    "type": "event",
    "members": [
      {
        "kind": "key",
        "name": "pool",
        "type": "core::starknet::contract_address::ContractAddress"
      },
      {
        "kind": "key",
        "name": "asset",
        "type": "core::starknet::contract_address::ContractAddress"
      }
    ]
  },
  {
    "kind": "struct",
    "name": "vesu::pool_factory::PoolFactory::CreateOracle",
    "type": "event",
    "members": [
      {
        "kind": "key",
        "name": "oracle",
        "type": "core::starknet::contract_address::ContractAddress"
      },
      {
        "kind": "key",
        "name": "manager",
        "type": "core::starknet::contract_address::ContractAddress"
      }
    ]
  },
  {
    "kind": "struct",
    "name": "vesu::pool_factory::PoolFactory::ContractUpgraded",
    "type": "event",
    "members": [
      {
        "kind": "data",
        "name": "new_implementation",
        "type": "core::starknet::class_hash::ClassHash"
      }
    ]
  },
  {
    "kind": "enum",
    "name": "vesu::pool_factory::PoolFactory::Event",
    "type": "event",
    "variants": [
      {
        "kind": "flat",
        "name": "OwnableEvent",
        "type": "openzeppelin_access::ownable::ownable::OwnableComponent::Event"
      },
      {
        "kind": "nested",
        "name": "CreateVToken",
        "type": "vesu::pool_factory::PoolFactory::CreateVToken"
      },
      {
        "kind": "nested",
        "name": "UpdateVToken",
        "type": "vesu::pool_factory::PoolFactory::UpdateVToken"
      },
      {
        "kind": "nested",
        "name": "CreatePool",
        "type": "vesu::pool_factory::PoolFactory::CreatePool"
      },
      {
        "kind": "nested",
        "name": "AddAsset",
        "type": "vesu::pool_factory::PoolFactory::AddAsset"
      },
      {
        "kind": "nested",
        "name": "CreateOracle",
        "type": "vesu::pool_factory::PoolFactory::CreateOracle"
      },
      {
        "kind": "nested",
        "name": "ContractUpgraded",
        "type": "vesu::pool_factory::PoolFactory::ContractUpgraded"
      }
    ]
  }
] as const;
