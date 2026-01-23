import { AddNewEventsAction } from '../AddNewEventsAction';
import { ChainConfigService } from '../../../config/services/ChainConfigService';
import { Web3Service } from '../../../../web3/services/Web3Service';
import { SolanaReaderService } from '../SolanaReaderService';
import { SubmissionProcessingService } from '../SubmissionProcessingService';
import { TransformService } from '../TransformService';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { SupportedChainEntity } from '../../../../../entities/SupportedChainEntity';

describe('AddNewEventsAction', () => {
  let service: AddNewEventsAction;
  let processMock;
  let syncTransactionsMock;
  let getPastEventsMock;
  let web3;

  beforeEach(async () => {
    processMock = jest.fn().mockResolvedValue({});
    syncTransactionsMock = jest.fn().mockResolvedValue({});
    getPastEventsMock = jest.fn().mockResolvedValue([
      {
        returnValues: {
          submissionId: 123,
          chainIdFrom: 1,
          chainIdTo: 2,
          debridgeId: 456,
          receiver: 'xyz',
          amount: 100,
          nonce: '789',
        },
        transactionHash: 'abc',
        blockNumber: 10,
      },
    ]);

    web3 = {
      eth: {
        setProvider: jest.fn().mockResolvedValue({}),
        Contract: jest.fn().mockImplementation(() => {
          return {
            setProvider: jest.fn().mockResolvedValue({}),
            getPastEvents: getPastEventsMock,
          };
        }),
        getBlockNumber: jest.fn().mockResolvedValue(100),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: getRepositoryToken(SupportedChainEntity),
          useValue: {
            findOne: async chainId => {
              return {
                chainId,
                latestBlock: 98,
                network: 'eth',
              } as SupportedChainEntity;
            },
            update: jest.fn().mockResolvedValue({}),
          },
        },
        ChainConfigService,
        {
          provide: ChainConfigService,
          useValue: {
            get(chainId) {
              return {
                chainId,
                isSolana: chainId !== 1,
                maxBlockRange: 200,
                blockConfirmation: 1,
                debridgeAddr: 'debridgeAddr',
                providers: 'providers',
              };
            },
          },
        },
        {
          provide: Web3Service,
          useValue: {
            web3HttpProvider: jest.fn().mockImplementation(() => {
              return web3;
            }),
          },
        },
        {
          provide: SolanaReaderService,
          useValue: {
            syncTransactions: syncTransactionsMock,
          },
        },
        {
          provide: SubmissionProcessingService,
          useValue: {
            process: processMock,
          },
        },
        TransformService,
        AddNewEventsAction,
      ],
    }).compile();
    service = module.get(AddNewEventsAction);
  });

  it('should solana be executed', async () => {
    await service.action(2);
    expect(syncTransactionsMock).toBeCalled();
  });

  it('should eth be executed', async () => {
    await service.action(1);
    expect(syncTransactionsMock).toBeCalledTimes(0);
    expect(getPastEventsMock).toBeCalledWith('Sent', {
      fromBlock: 98,
      toBlock: 99,
    });
    expect(processMock).toHaveBeenCalledWith(
      [
        {
          submissionId: 123,
          txHash: 'abc',
          chainFrom: 1,
          chainTo: 2,
          debridgeId: 456,
          receiverAddr: 'xyz',
          amount: 100,
          status: 1,
          ipfsStatus: 1,
          apiStatus: 1,
          assetsStatus: 1,
          rawEvent:
            '{"returnValues":{"submissionId":123,"chainIdFrom":1,"chainIdTo":2,"debridgeId":456,"receiver":"xyz","amount":100,"nonce":"789"},"transactionHash":"abc","blockNumber":10}',
          blockNumber: 10,
          nonce: 789,
          bundlrStatus: 1,
        },
      ],
      1,
      99,
      web3,
    );
    expect(processMock).toBeCalledTimes(1);
  });

  describe('stale RPC response handling', () => {
    let staleRpcService: AddNewEventsAction;
    let staleWeb3;
    let staleGetPastEventsMock;
    let staleProcessMock;
    let updateMock;

    beforeEach(async () => {
      staleProcessMock = jest.fn().mockResolvedValue({});
      staleGetPastEventsMock = jest.fn().mockResolvedValue([]);
      updateMock = jest.fn().mockResolvedValue({});

      // Simulate stale RPC: getBlockNumber returns 100, but latestBlock in DB is 200
      // This means fromBlock (200) > toBlock (99) after blockConfirmation
      staleWeb3 = {
        eth: {
          setProvider: jest.fn().mockResolvedValue({}),
          Contract: jest.fn().mockImplementation(() => {
            return {
              setProvider: jest.fn().mockResolvedValue({}),
              getPastEvents: staleGetPastEventsMock,
            };
          }),
          getBlockNumber: jest.fn().mockResolvedValue(100), // RPC returns block 100
        },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          {
            provide: getRepositoryToken(SupportedChainEntity),
            useValue: {
              findOne: async () => {
                return {
                  chainId: 1,
                  latestBlock: 200, // DB has synced to block 200 (ahead of RPC)
                  network: 'eth',
                } as SupportedChainEntity;
              },
              update: updateMock,
            },
          },
          {
            provide: ChainConfigService,
            useValue: {
              get(chainId) {
                return {
                  chainId,
                  isSolana: false,
                  maxBlockRange: 200,
                  blockConfirmation: 1,
                  debridgeAddr: 'debridgeAddr',
                  providers: 'providers',
                };
              },
            },
          },
          {
            provide: Web3Service,
            useValue: {
              web3HttpProvider: jest.fn().mockImplementation(() => staleWeb3),
            },
          },
          {
            provide: SolanaReaderService,
            useValue: {
              syncTransactions: jest.fn().mockResolvedValue({}),
            },
          },
          {
            provide: SubmissionProcessingService,
            useValue: {
              process: staleProcessMock,
            },
          },
          TransformService,
          AddNewEventsAction,
        ],
      }).compile();
      staleRpcService = module.get(AddNewEventsAction);
    });

    it('should reset latestBlock to toBlock when RPC returns stale block number', async () => {
      await staleRpcService.action(1);

      // Should NOT fetch events when fromBlock > toBlock
      expect(staleGetPastEventsMock).not.toBeCalled();

      // Should NOT process any submissions
      expect(staleProcessMock).not.toBeCalled();

      // Should update latestBlock to toBlock (99) to prevent massive resync
      // toBlock = getBlockNumber(100) - blockConfirmation(1) = 99
      expect(updateMock).toBeCalledWith(1, { latestBlock: 99 });
    });
  });
});
