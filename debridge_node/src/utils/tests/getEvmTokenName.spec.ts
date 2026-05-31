import Web3 from 'web3';
import { getEvmTokenName } from '../getEvmTokenName';
import { Logger } from '@nestjs/common';

const RPC_URL = 'https://ethereum-rpc.publicnode.com';
const logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() } as unknown as Logger;

const createMockWeb3 = (callResult: any) => ({
  eth: {
    Contract: jest.fn().mockReturnValue({
      methods: {
        name: jest.fn().mockReturnValue({
          call: typeof callResult === 'function' ? callResult : jest.fn().mockResolvedValue(callResult),
        }),
      },
    }),
  },
  utils: {
    hexToUtf8: jest.fn().mockImplementation(hex => hex),
  },
});

describe('getEvmTokenName()', () => {
  describe('RPC', () => {
    const web3 = new Web3(RPC_URL);

    it('returns name for normal token', async () => {
      const name = await getEvmTokenName(logger, web3, '0xdac17f958d2ee523a2206206994597c13d831ec7');
      expect(name).toBe('Tether USD');
    });

    it('returns name for DS token', async () => {
      const name = await getEvmTokenName(logger, web3, '0x8e0E57DCb1ce8d9091dF38ec1BfC3b224529754A');
      expect(name).toBe('Moon Tropica');
    });

    it('returns empty string for tokens without name', async () => {
      const name = await getEvmTokenName(logger, web3, '0xeF4fB24aD0916217251F553c0596F8Edc630EB66');
      expect(name).toBe('');
    });

    it('throws error if web3 connection is failed', async () => {
      const badWeb3 = new Web3('https://ethereum-rpc.publicnode.com.invalid');
      await expect(
        getEvmTokenName(logger, badWeb3, '0xeF4fB24aD0916217251F553c0596F8Edc630EB66'),
      ).rejects.toThrow();
    });
  });

  describe('Mock', () => {
    it('returns name for normal token', async () => {
      const web3 = createMockWeb3('Tether USD');
      const name = await getEvmTokenName(logger, web3 as any, '0xdac17f958d2ee523a2206206994597c13d831ec7');
      expect(name).toBe('Tether USD');
    });

    it('returns name for DS token (NUMERIC_FAULT fallback)', async () => {
      const erc20Contract = {
        methods: {
          name: jest.fn().mockReturnValue({
            call: jest.fn().mockRejectedValue(new Error('NUMERIC_FAULT: could not decode')),
          }),
        },
      };
      const dsTokenContract = {
        methods: {
          name: jest.fn().mockReturnValue({
            call: jest.fn().mockResolvedValue('0x4d6f6f6e2054726f70696361'),
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
          hexToUtf8: jest.fn().mockReturnValue('Moon Tropica'),
        },
      };

      const name = await getEvmTokenName(logger, web3 as any, '0x8e0E57DCb1ce8d9091dF38ec1BfC3b224529754A');
      expect(name).toBe('Moon Tropica');
      expect(web3.utils.hexToUtf8).toHaveBeenCalledWith('0x4d6f6f6e2054726f70696361');
    });

    it('returns empty string for tokens without name (execution reverted)', async () => {
      const web3 = createMockWeb3(
        jest.fn().mockRejectedValue(new Error('Returned error: execution reverted')),
      );
      const name = await getEvmTokenName(logger, web3 as any, '0xeF4fB24aD0916217251F553c0596F8Edc630EB66');
      expect(name).toBe('');
    });

    it('throws error for unknown failures', async () => {
      const web3 = createMockWeb3(
        jest.fn().mockRejectedValue(new Error('CONNECTION ERROR: some network failure')),
      );
      await expect(
        getEvmTokenName(logger, web3 as any, '0xeF4fB24aD0916217251F553c0596F8Edc630EB66'),
      ).rejects.toThrow('CONNECTION ERROR: some network failure');
    });
  });
});
