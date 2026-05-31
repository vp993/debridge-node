import Web3 from 'web3';
import { getEvmTokenSymbol } from '../getEvmTokenSymbol';
import { Logger } from '@nestjs/common';

const RPC_URL = 'https://ethereum-rpc.publicnode.com';
const logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() } as unknown as Logger;

const createMockWeb3 = (callResult: any) => ({
  eth: {
    Contract: jest.fn().mockReturnValue({
      methods: {
        symbol: jest.fn().mockReturnValue({
          call: typeof callResult === 'function' ? callResult : jest.fn().mockResolvedValue(callResult),
        }),
      },
    }),
  },
  utils: {
    hexToUtf8: jest.fn().mockImplementation(hex => hex),
  },
});

describe('getEvmTokenSymbol()', () => {
  describe('RPC', () => {
    const web3 = new Web3(RPC_URL);

    it('returns symbol for normal token', async () => {
      const symbol = await getEvmTokenSymbol(logger, web3, '0xdac17f958d2ee523a2206206994597c13d831ec7');
      expect(symbol).toBe('USDT');
    });

    it('returns symbol for DS token', async () => {
      const symbol = await getEvmTokenSymbol(logger, web3, '0x8e0E57DCb1ce8d9091dF38ec1BfC3b224529754A');
      expect(symbol).toBe('CAH');
    });

    it('throws error if web3 connection is failed', async () => {
      const badWeb3 = new Web3('https://ethereum-rpc.publicnode.com.invalid');
      await expect(
        getEvmTokenSymbol(logger, badWeb3, '0xeF4fB24aD0916217251F553c0596F8Edc630EB66'),
      ).rejects.toThrow();
    });
  });

  describe('Mock', () => {
    it('returns symbol for normal token', async () => {
      const web3 = createMockWeb3('USDT');
      const symbol = await getEvmTokenSymbol(logger, web3 as any, '0xdac17f958d2ee523a2206206994597c13d831ec7');
      expect(symbol).toBe('USDT');
    });

    it('returns symbol for DS token (NUMERIC_FAULT fallback)', async () => {
      const erc20Contract = {
        methods: {
          symbol: jest.fn().mockReturnValue({
            call: jest.fn().mockRejectedValue(new Error('NUMERIC_FAULT: could not decode')),
          }),
        },
      };
      const dsTokenContract = {
        methods: {
          symbol: jest.fn().mockReturnValue({
            call: jest.fn().mockResolvedValue('0x434148'),
          }),
        },
      };

      const web3 = {
        eth: {
          Contract: jest.fn()
            .mockReturnValueOnce(erc20Contract)
            .mockReturnValueOnce(dsTokenContract),
        },
        utils: {
          hexToUtf8: jest.fn().mockReturnValue('CAH'),
        },
      };

      const symbol = await getEvmTokenSymbol(logger, web3 as any, '0x8e0E57DCb1ce8d9091dF38ec1BfC3b224529754A');
      expect(symbol).toBe('CAH');
      expect(web3.utils.hexToUtf8).toHaveBeenCalledWith('0x434148');
    });

    it('throws error for unknown failures', async () => {
      const web3 = createMockWeb3(
        jest.fn().mockRejectedValue(new Error('CONNECTION ERROR: some network failure')),
      );
      await expect(
        getEvmTokenSymbol(logger, web3 as any, '0xeF4fB24aD0916217251F553c0596F8Edc630EB66'),
      ).rejects.toThrow('CONNECTION ERROR: some network failure');
    });
  });
});
