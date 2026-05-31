import { Web3Service } from './Web3Service';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ChainConfigService } from '../../chain/config/services/ChainConfigService';
import { EvmChainConfig } from '../../chain/config/models/configs/EvmChainConfig';

const CHAIN_ID_ETH = 1;
const CHAIN_ID_BSC = 56;
const CHAIN_ID_POLYGON = 137;
const CHAIN_ID_ARBITRUM = 42161;

const RPC_ETH_WORKING = 'https://rpc-eth-working.debridge.com';
const RPC_BSC_FAILING = 'https://rpc-bsc-failing.debridge.com';
const RPC_BSC_WORKING = 'https://rpc-bsc-working.debridge.com';
const RPC_POLYGON_WORKING = 'https://rpc-polygon-working.debridge.com';
const RPC_ARBITRUM_FAILING = 'https://rpc-arbitrum-failing.debridge.com';

jest.mock('../../../config/chains_config.json', () => {
  return [
    {
      chainId: 1,
      name: 'ETHEREUM',
      debridgeAddr: '0x43dE2d77BF8027e25dBD179B491e8d64f38398aA',
      firstStartBlock: 13665321,
      provider: 'https://rpc-eth-working.debridge.com',
      interval: 10000,
      blockConfirmation: 12,
      maxBlockRange: 5000,
    },
    {
      chainId: 56,
      name: 'BSC',
      debridgeAddr: '0x43dE2d77BF8027e25dBD179B491e8d64f38398aA',
      firstStartBlock: 13665321,
      providers: ['https://rpc-bsc-failing.debridge.com', 'https://rpc-bsc-working.debridge.com'],
      interval: 10000,
      blockConfirmation: 12,
      maxBlockRange: 5000,
    },
    {
      chainId: 137,
      name: 'POLYGON',
      debridgeAddr: '0x43dE2d77BF8027e25dBD179B491e8d64f38398aA',
      firstStartBlock: 13665321,
      providers: [
        {
          provider: 'https://rpc-polygon-working.debridge.com',
          user: 'anton',
          password: '123',
          authType: 'BASIC',
        },
      ],
      interval: 10000,
      blockConfirmation: 12,
      maxBlockRange: 5000,
    },
    {
      chainId: 42161,
      name: 'ARBITRUM',
      debridgeAddr: '0x43dE2d77BF8027e25dBD179B491e8d64f38398aA',
      firstStartBlock: 13665321,
      providers: ['https://rpc-arbitrum-failing.debridge.com'],
      interval: 10000,
      blockConfirmation: 12,
      maxBlockRange: 5000,
    },
  ];
});

jest.mock('web3', () => {
  return class {
    static providers = {
      HttpProvider: class {
        constructor(public provider: string, public config: object) {}
        send = jest.fn((payload, callback) => callback(null, {}));
      },
    };

    provider: string;

    constructor(obj) {
      this.provider = obj?.provider;
    }

    eth = {
      getChainId: async () => {
        return 1;
      },

      getBlockNumber: async () => {
        if (this.provider.includes('failing')) {
          throw new Error(`connect ECONNREFUSED ${this.provider}`);
        }
        return 10;
      },

      Contract: jest.fn().mockImplementation(() => ({
        methods: {
          getChainId: jest.fn().mockReturnValue({
            call: jest.fn().mockResolvedValue(1),
          }),
        },
        setProvider: jest.fn(),
      })),
    };
  };
});

describe('Web3Service', () => {
  let web3Service: Web3Service;
  let chainConfigService: ChainConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot()],
      providers: [Web3Service, ChainConfigService],
    }).compile();

    web3Service = module.get(Web3Service);
    chainConfigService = module.get(ChainConfigService);
  });

  describe('validateChainId', () => {
    it('marks provider as valid when on-chain chainId matches config', async () => {
      const config = chainConfigService.get(CHAIN_ID_ETH) as EvmChainConfig;
      jest.spyOn(config.providers, 'setProviderValidationStatus');

      await web3Service.validateChainId(config, RPC_ETH_WORKING);

      expect(config.providers.setProviderValidationStatus).toHaveBeenCalledWith(
        RPC_ETH_WORKING,
        true,
      );
    });

    it('terminates process when on-chain chainId does not match config', async () => {
      const config = chainConfigService.get(CHAIN_ID_BSC) as EvmChainConfig;
      const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(code.toString());
      });

      await web3Service.validateChainId(config, RPC_BSC_WORKING);

      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe('web3HttpProvider', () => {
    describe('with pre-validated providers', () => {
      let config: EvmChainConfig;

      beforeEach(() => {
        config = chainConfigService.get(CHAIN_ID_BSC) as EvmChainConfig;
        config.providers.setProviderValidationStatus(RPC_BSC_FAILING, true);
        config.providers.setProviderValidationStatus(RPC_BSC_WORKING, true);
      });

      it('falls back to next provider when first is unreachable', async () => {
        const result = await web3Service.web3HttpProvider(config);

        expect(result.chainProvider).toBe(RPC_BSC_WORKING);
      });

      it('marks unreachable provider as failed', async () => {
        jest.spyOn(config.providers, 'setProviderStatus');

        await web3Service.web3HttpProvider(config);

        expect(config.providers.setProviderStatus).toHaveBeenCalledWith(
          RPC_BSC_FAILING,
          false,
        );
      });

      it('marks reachable provider as active', async () => {
        jest.spyOn(config.providers, 'setProviderStatus');

        await web3Service.web3HttpProvider(config);

        expect(config.providers.setProviderStatus).toHaveBeenCalledWith(
          RPC_BSC_WORKING,
          true,
        );
      });

      it('reuses cached provider on subsequent calls', async () => {
        const first = await web3Service.web3HttpProvider(config);
        const second = await web3Service.web3HttpProvider(config);

        expect(second).toBe(first);
      });

      it('skips validateChainId when provider is already validated', async () => {
        const spy = jest.spyOn(web3Service, 'validateChainId');

        await web3Service.web3HttpProvider(config);

        expect(spy).not.toHaveBeenCalled();
      });

      it('reconnects when cached provider becomes unhealthy', async () => {
        const first = await web3Service.web3HttpProvider(config);

        first.eth.getBlockNumber = async () => { throw new Error('CONNECTION ERROR: connection timeout after 10000ms'); };

        const second = await web3Service.web3HttpProvider(config);

        expect(second).not.toBe(first);
        expect(second.chainProvider).toBe(RPC_BSC_WORKING);
      });
    });

    it('throws when all providers are unreachable', async () => {
      const arbConfig = chainConfigService.get(CHAIN_ID_ARBITRUM) as EvmChainConfig;

      await expect(web3Service.web3HttpProvider(arbConfig)).rejects.toThrow(
        /Cann't connect to any provider/,
      );
    });

    it('still uses provider when validateChainId fails due to chainId mismatch', async () => {
      const config = chainConfigService.get(CHAIN_ID_BSC) as EvmChainConfig;
      config.providers.setProviderValidationStatus(RPC_BSC_FAILING, true);
      config.providers.setProviderValidationStatus(RPC_BSC_WORKING, true);
      jest.spyOn(config.providers, 'getProviderValidationStatus').mockReturnValue(false);

      const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(code.toString());
      });

      const result = await web3Service.web3HttpProvider(config);

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(result.chainProvider).toBe(RPC_BSC_WORKING);
    });
  });
});
