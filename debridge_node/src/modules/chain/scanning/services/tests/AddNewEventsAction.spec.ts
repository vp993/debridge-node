import { AddNewEventsAction } from '../AddNewEventsAction';
import { ChainConfigService } from '../../../config/services/ChainConfigService';
import { Web3Service } from '../../../../web3/services/Web3Service';
import { SolanaReaderService } from '../SolanaReaderService';
import { SubmissionProcessingService } from '../SubmissionProcessingService';
import { TransformService } from '../TransformService';
import { SubmissionEntity } from '../../../../../entities/SubmissionEntity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { SupportedChainEntity } from '../../../../../entities/SupportedChainEntity';

/**
 * Creates an AddNewEventsAction service with configurable mocks.
 *
 * @param chainId              - chain identifier used in action() call and DB lookups
 * @param latestBlock          - scan progress in DB (becomes fromBlock)
 * @param rpcBlockNumber       - what RPC returns as latest block (toBlock = rpcBlockNumber - blockConfirmation)
 * @param isSolana             - whether the chain is treated as Solana (uses syncTransactions instead of getPastEvents)
 * @param lastEventBlockNumber - highest blockNumber in submissions table, null if no events
 * @param events               - raw events returned by getPastEvents (default: [])
 * @param blockConfirmation    - number of blocks subtracted from RPC head (default: 1)
 */
async function buildService(config: {
  chainId: number;
  latestBlock: number;
  rpcBlockNumber: number;
  isSolana?: boolean;
  lastEventBlockNumber?: number | null;
  events?: any[];
  blockConfirmation?: number;
}) {
  const isSolana = config.isSolana ?? false;
  const blockConfirmation = config.blockConfirmation ?? 1;
  const events = config.events ?? [];
  const lastEventBlockNumber = config.lastEventBlockNumber ?? null;

  const updateMock = jest.fn().mockResolvedValue({});
  const getPastEventsMock = jest.fn().mockResolvedValue(events);
  const processMock = jest.fn().mockResolvedValue({});
  const syncTransactionsMock = jest.fn().mockResolvedValue({});
  const submissionsFindOneMock = jest.fn().mockResolvedValue(
    lastEventBlockNumber !== null
      ? { blockNumber: lastEventBlockNumber, chainFrom: config.chainId }
      : null,
  );

  const web3Mock = {
    eth: {
      setProvider: jest.fn(),
      Contract: jest.fn().mockImplementation(() => ({
        setProvider: jest.fn(),
        getPastEvents: getPastEventsMock,
      })),
      getBlockNumber: jest.fn().mockResolvedValue(config.rpcBlockNumber),
    },
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      {
        provide: getRepositoryToken(SupportedChainEntity),
        useValue: {
          findOne: jest.fn().mockResolvedValue({
            chainId: config.chainId,
            latestBlock: config.latestBlock,
            network: 'eth',
          }),
          update: updateMock,
        },
      },
      {
        provide: getRepositoryToken(SubmissionEntity),
        useValue: {
          findOne: submissionsFindOneMock,
        },
      },
      {
        provide: ChainConfigService,
        useValue: {
          get(chainId) {
            return {
              chainId,
              isSolana,
              maxBlockRange: 200,
              blockConfirmation,
              debridgeAddr: 'debridgeAddr',
              providers: 'providers',
            };
          },
        },
      },
      {
        provide: Web3Service,
        useValue: {
          web3HttpProvider: jest.fn().mockImplementation(() => web3Mock),
        },
      },
      {
        provide: SolanaReaderService,
        useValue: { syncTransactions: syncTransactionsMock },
      },
      {
        provide: SubmissionProcessingService,
        useValue: { process: processMock },
      },
      TransformService,
      AddNewEventsAction,
    ],
  }).compile();

  return {
    service: module.get(AddNewEventsAction),
    chainId: config.chainId,
    web3: web3Mock,
    updateMock,
    getPastEventsMock,
    processMock,
    syncTransactionsMock,
  };
}

describe('AddNewEventsAction', () => {
  // Solana chain uses syncTransactions, EVM chain uses process() with getPastEvents.
  describe('chain routing', () => {
    it('Solana chain — calls syncTransactions, not process', async () => {
      const { service, chainId, syncTransactionsMock, processMock } = await buildService({
        chainId: 2,
        latestBlock: 0,
        rpcBlockNumber: 100,
        isSolana: true,
      });

      await service.action(chainId);

      expect(syncTransactionsMock).toBeCalled();
      expect(processMock).not.toBeCalled();
    });

    it('EVM chain — calls process, not syncTransactions', async () => {
      const { service, chainId, syncTransactionsMock } = await buildService({
        chainId: 1,
        latestBlock: 0,
        rpcBlockNumber: 100,
        isSolana: false,
      });

      await service.action(chainId);

      expect(syncTransactionsMock).not.toBeCalled();
    });
  });

  // Normal EVM scan: latestBlock=98, RPC=100, blockConfirmation=1 → scans blocks 98..99.
  // Verifies that getPastEvents is called with correct range and process receives
  // a correctly transformed submission.
  describe('EVM event scanning', () => {
    it('scans correct block range and transforms events into submissions', async () => {
      const { service, chainId, getPastEventsMock, processMock, web3 } = await buildService({
        chainId: 1,
        latestBlock: 98,       // fromBlock = 98
        rpcBlockNumber: 100,   // toBlock = 100 - 1 = 99
        events: [
          {
            returnValues: {
              submissionId: 123,
              chainIdFrom: 1,
              chainIdTo: 56,
              debridgeId: 456,
              receiver: 'xyz',
              amount: 100,
              nonce: '789',
            },
            transactionHash: 'abc',
            blockNumber: 10,
          },
        ],
      });

      await service.action(chainId);

      // fromBlock=98 (latestBlock in DB), toBlock=99 (rpc 100 - confirmation 1)
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
            chainTo: 56,
            debridgeId: 456,
            receiverAddr: 'xyz',
            amount: 100,
            status: 1,
            ipfsStatus: 1,
            apiStatus: 1,
            assetsStatus: 1,
            rawEvent:
              '{"returnValues":{"submissionId":123,"chainIdFrom":1,"chainIdTo":56,"debridgeId":456,"receiver":"xyz","amount":100,"nonce":"789"},"transactionHash":"abc","blockNumber":10}',
            blockNumber: 10,
            nonce: 789,
            bundlrStatus: 1,
          },
        ],
        chainId, // chainId
        99,      // lastBlockOfPage
        web3,
      );
      expect(processMock).toBeCalledTimes(1);
    });
  });

  /**
   * When fromBlock > toBlock, the scanner detects a stale/broken RPC response.
   *
   * Recovery logic: safeBlock = Math.max(lastEvent.blockNumber, toBlock)
   *   - Protects against RPC returning 0 or garbage (would otherwise reset progress to 0)
   *   - Minimizes rescan range by picking the highest known-good block
   *
   * How values are computed:
   *   - fromBlock = supportedChain.latestBlock (scan progress stored in DB)
   *   - toBlock   = rpcBlockNumber - blockConfirmation (confirmed head from RPC)
   *   - blockConfirmation = 1 in all tests below, so toBlock = rpcBlockNumber - 1
   */
  describe('fromBlock > toBlock: stale/broken RPC handling', () => {
    // RPC is behind: returned block 100, but we already scanned up to 200.
    // Last event in DB is at block 50, which is below toBlock (99).
    // safeBlock = Math.max(50, 99) = 99 — picks toBlock, minimal rollback.
    it('RPC slightly behind, last event below toBlock — uses toBlock', async () => {
      const { service, chainId, updateMock, getPastEventsMock, processMock } = await buildService({
        chainId: 56,
        latestBlock: 200,
        rpcBlockNumber: 100,
        lastEventBlockNumber: 50,
      });

      await service.action(chainId);

      expect(updateMock).toBeCalledWith(chainId, { latestBlock: 99 });
      expect(getPastEventsMock).not.toBeCalled();
      expect(processMock).not.toBeCalled();
    });

    // RPC is behind: returned block 100, but we already scanned up to 200.
    // Last event in DB is at block 190, which is above toBlock (99).
    // safeBlock = Math.max(190, 99) = 190 — preserves progress closer to reality.
    it('RPC slightly behind, last event above toBlock — preserves progress', async () => {
      const { service, chainId, updateMock } = await buildService({
        chainId: 42161,
        latestBlock: 200,
        rpcBlockNumber: 100,
        lastEventBlockNumber: 190,
      });

      await service.action(chainId);

      expect(updateMock).toBeCalledWith(chainId, { latestBlock: 190 });
    });

    // RPC returned 0 (broken response). toBlock = 0 - 1 = -1.
    // Even though we have events in DB, we skip entirely — don't trust any data from this RPC call.
    it('RPC returns 0 with events in DB — skips scan, does NOT touch progress', async () => {
      const { service, chainId, updateMock, getPastEventsMock, processMock } = await buildService({
        chainId: 1,
        latestBlock: 50_000_000,
        rpcBlockNumber: 0,
        lastEventBlockNumber: 49_999_500,
      });

      await service.action(chainId);

      expect(updateMock).not.toBeCalled();
      expect(getPastEventsMock).not.toBeCalled();
      expect(processMock).not.toBeCalled();
    });

    // RPC is behind and there are no events in DB (new chain or empty table).
    // safeBlock = Math.max(0, 99) = 99 — toBlock is the only reference point.
    it('no events in DB — falls back to toBlock', async () => {
      const { service, chainId, updateMock } = await buildService({
        chainId: 137,
        latestBlock: 200,
        rpcBlockNumber: 100,
        lastEventBlockNumber: null,
      });

      await service.action(chainId);

      expect(updateMock).toBeCalledWith(chainId, { latestBlock: 99 });
    });

    // RPC returned 0 → toBlock = 0 - 1 = -1. This is completely broken.
    // We must skip the scan entirely and NOT touch latestBlock in DB.
    it('RPC returns 0 with no events in DB — skips scan, does NOT reset progress', async () => {
      const { service, chainId, updateMock, getPastEventsMock, processMock } = await buildService({
        chainId: 10,
        latestBlock: 50_000_000,
        rpcBlockNumber: 0,
        lastEventBlockNumber: null,
      });

      await service.action(chainId);

      expect(updateMock).not.toBeCalled();
      expect(getPastEventsMock).not.toBeCalled();
      expect(processMock).not.toBeCalled();
    });
  });
});
