/**
 * JediswapV2 Factory ABI (similar to UniswapV3): 
 *
 * https://starkscan.co/contract/0x01aa950c9b974294787de8df8880ecf668840a6ab8fa8290bf2952212b375148#class-code-history
 * https://voyager.online/class/0x038082dfcc9e1afd67eaabcb9b0cff0646237badf22a494bcfc72532c8fc2249
 */
export const factoryAbi = [
  {
    "name": "JediSwapV2FactoryImpl",
    "type": "impl",
    "interface_name": "jediswap_v2_core::jediswap_v2_factory::IJediSwapV2Factory"
  },
  {
    "name": "jediswap_v2_core::jediswap_v2_factory::IJediSwapV2Factory",
    "type": "interface",
    "items": [
      {
        "name": "fee_amount_tick_spacing",
        "type": "function",
        "inputs": [
          {
            "name": "fee",
            "type": "core::integer::u32"
          }
        ],
        "outputs": [
          {
            "type": "core::integer::u32"
          }
        ],
        "state_mutability": "view"
      },
      {
        "name": "get_pool",
        "type": "function",
        "inputs": [
          {
            "name": "token_a",
            "type": "core::starknet::contract_address::ContractAddress"
          },
          {
            "name": "token_b",
            "type": "core::starknet::contract_address::ContractAddress"
          },
          {
            "name": "fee",
            "type": "core::integer::u32"
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
        "name": "get_fee_protocol",
        "type": "function",
        "inputs": [],
        "outputs": [
          {
            "type": "core::integer::u8"
          }
        ],
        "state_mutability": "view"
      },
      {
        "name": "get_pool_class_hash",
        "type": "function",
        "inputs": [],
        "outputs": [
          {
            "type": "core::starknet::class_hash::ClassHash"
          }
        ],
        "state_mutability": "view"
      },
      {
        "name": "create_pool",
        "type": "function",
        "inputs": [
          {
            "name": "token_a",
            "type": "core::starknet::contract_address::ContractAddress"
          },
          {
            "name": "token_b",
            "type": "core::starknet::contract_address::ContractAddress"
          },
          {
            "name": "fee",
            "type": "core::integer::u32"
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
        "name": "enable_fee_amount",
        "type": "function",
        "inputs": [
          {
            "name": "fee",
            "type": "core::integer::u32"
          },
          {
            "name": "tick_spacing",
            "type": "core::integer::u32"
          }
        ],
        "outputs": [],
        "state_mutability": "external"
      },
      {
        "name": "set_fee_protocol",
        "type": "function",
        "inputs": [
          {
            "name": "fee_protocol",
            "type": "core::integer::u8"
          }
        ],
        "outputs": [],
        "state_mutability": "external"
      },
      {
        "name": "upgrade",
        "type": "function",
        "inputs": [
          {
            "name": "new_class_hash",
            "type": "core::starknet::class_hash::ClassHash"
          },
          {
            "name": "new_pool_class_hash",
            "type": "core::starknet::class_hash::ClassHash"
          }
        ],
        "outputs": [],
        "state_mutability": "external"
      },
      {
        "name": "pause",
        "type": "function",
        "inputs": [],
        "outputs": [],
        "state_mutability": "external"
      },
      {
        "name": "unpause",
        "type": "function",
        "inputs": [],
        "outputs": [],
        "state_mutability": "external"
      }
    ]
  },
  {
    "name": "OwnableImpl",
    "type": "impl",
    "interface_name": "openzeppelin::access::ownable::interface::IOwnable"
  },
  {
    "name": "openzeppelin::access::ownable::interface::IOwnable",
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
    "name": "PausableImpl",
    "type": "impl",
    "interface_name": "openzeppelin::security::interface::IPausable"
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
    "name": "openzeppelin::security::interface::IPausable",
    "type": "interface",
    "items": [
      {
        "name": "is_paused",
        "type": "function",
        "inputs": [],
        "outputs": [
          {
            "type": "core::bool"
          }
        ],
        "state_mutability": "view"
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
        "type": "core::starknet::class_hash::ClassHash"
      }
    ]
  },
  {
    "kind": "struct",
    "name": "jediswap_v2_core::jediswap_v2_factory::JediSwapV2Factory::PoolCreated",
    "type": "event",
    "members": [
      {
        "kind": "data",
        "name": "token0",
        "type": "core::starknet::contract_address::ContractAddress"
      },
      {
        "kind": "data",
        "name": "token1",
        "type": "core::starknet::contract_address::ContractAddress"
      },
      {
        "kind": "data",
        "name": "fee",
        "type": "core::integer::u32"
      },
      {
        "kind": "data",
        "name": "tick_spacing",
        "type": "core::integer::u32"
      },
      {
        "kind": "data",
        "name": "pool",
        "type": "core::starknet::contract_address::ContractAddress"
      }
    ]
  },
  {
    "kind": "struct",
    "name": "jediswap_v2_core::jediswap_v2_factory::JediSwapV2Factory::FeeAmountEnabled",
    "type": "event",
    "members": [
      {
        "kind": "data",
        "name": "fee",
        "type": "core::integer::u32"
      },
      {
        "kind": "data",
        "name": "tick_spacing",
        "type": "core::integer::u32"
      }
    ]
  },
  {
    "kind": "struct",
    "name": "jediswap_v2_core::jediswap_v2_factory::JediSwapV2Factory::SetFeeProtocol",
    "type": "event",
    "members": [
      {
        "kind": "data",
        "name": "old_fee_protocol",
        "type": "core::integer::u8"
      },
      {
        "kind": "data",
        "name": "new_fee_protocol",
        "type": "core::integer::u8"
      }
    ]
  },
  {
    "kind": "struct",
    "name": "jediswap_v2_core::jediswap_v2_factory::JediSwapV2Factory::UpgradedPoolClassHash",
    "type": "event",
    "members": [
      {
        "kind": "data",
        "name": "class_hash",
        "type": "core::starknet::class_hash::ClassHash"
      }
    ]
  },
  {
    "kind": "struct",
    "name": "openzeppelin::access::ownable::ownable::OwnableComponent::OwnershipTransferred",
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
    "name": "openzeppelin::access::ownable::ownable::OwnableComponent::OwnershipTransferStarted",
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
    "name": "openzeppelin::access::ownable::ownable::OwnableComponent::Event",
    "type": "event",
    "variants": [
      {
        "kind": "nested",
        "name": "OwnershipTransferred",
        "type": "openzeppelin::access::ownable::ownable::OwnableComponent::OwnershipTransferred"
      },
      {
        "kind": "nested",
        "name": "OwnershipTransferStarted",
        "type": "openzeppelin::access::ownable::ownable::OwnableComponent::OwnershipTransferStarted"
      }
    ]
  },
  {
    "kind": "struct",
    "name": "openzeppelin::upgrades::upgradeable::UpgradeableComponent::Upgraded",
    "type": "event",
    "members": [
      {
        "kind": "data",
        "name": "class_hash",
        "type": "core::starknet::class_hash::ClassHash"
      }
    ]
  },
  {
    "kind": "enum",
    "name": "openzeppelin::upgrades::upgradeable::UpgradeableComponent::Event",
    "type": "event",
    "variants": [
      {
        "kind": "nested",
        "name": "Upgraded",
        "type": "openzeppelin::upgrades::upgradeable::UpgradeableComponent::Upgraded"
      }
    ]
  },
  {
    "kind": "struct",
    "name": "openzeppelin::security::pausable::PausableComponent::Paused",
    "type": "event",
    "members": [
      {
        "kind": "data",
        "name": "account",
        "type": "core::starknet::contract_address::ContractAddress"
      }
    ]
  },
  {
    "kind": "struct",
    "name": "openzeppelin::security::pausable::PausableComponent::Unpaused",
    "type": "event",
    "members": [
      {
        "kind": "data",
        "name": "account",
        "type": "core::starknet::contract_address::ContractAddress"
      }
    ]
  },
  {
    "kind": "enum",
    "name": "openzeppelin::security::pausable::PausableComponent::Event",
    "type": "event",
    "variants": [
      {
        "kind": "nested",
        "name": "Paused",
        "type": "openzeppelin::security::pausable::PausableComponent::Paused"
      },
      {
        "kind": "nested",
        "name": "Unpaused",
        "type": "openzeppelin::security::pausable::PausableComponent::Unpaused"
      }
    ]
  },
  {
    "kind": "enum",
    "name": "jediswap_v2_core::jediswap_v2_factory::JediSwapV2Factory::Event",
    "type": "event",
    "variants": [
      {
        "kind": "nested",
        "name": "PoolCreated",
        "type": "jediswap_v2_core::jediswap_v2_factory::JediSwapV2Factory::PoolCreated"
      },
      {
        "kind": "nested",
        "name": "FeeAmountEnabled",
        "type": "jediswap_v2_core::jediswap_v2_factory::JediSwapV2Factory::FeeAmountEnabled"
      },
      {
        "kind": "nested",
        "name": "SetFeeProtocol",
        "type": "jediswap_v2_core::jediswap_v2_factory::JediSwapV2Factory::SetFeeProtocol"
      },
      {
        "kind": "nested",
        "name": "UpgradedPoolClassHash",
        "type": "jediswap_v2_core::jediswap_v2_factory::JediSwapV2Factory::UpgradedPoolClassHash"
      },
      {
        "kind": "flat",
        "name": "OwnableEvent",
        "type": "openzeppelin::access::ownable::ownable::OwnableComponent::Event"
      },
      {
        "kind": "flat",
        "name": "UpgradeableEvent",
        "type": "openzeppelin::upgrades::upgradeable::UpgradeableComponent::Event"
      },
      {
        "kind": "flat",
        "name": "PausableEvent",
        "type": "openzeppelin::security::pausable::PausableComponent::Event"
      }
    ]
  }
] as const;
