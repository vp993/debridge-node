import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { SolanaReaderService } from '../SolanaReaderService';
import { TransformService } from '../TransformService';
import { SubmissionProcessingService } from '../SubmissionProcessingService';
import { SubmissionEntity } from '../../../../../entities/SubmissionEntity';
import { SupportedChainEntity } from '../../../../../entities/SupportedChainEntity';
import { SolanaEventsReaderService } from '../../../../solana-events-reader/services/SolanaEventsReaderService';
import { ProcessNewTransferResultStatusEnum } from '../../enums/ProcessNewTransferResultStatusEnum';

jest.mock('@debridge-finance/solana-grpc', () => ({
  SolanaGrpcClient: jest.fn(),
  U256Converter: {
    toBigInt: jest.fn().mockImplementation(val => {
      if (typeof val === 'number') return BigInt(val);
      if (typeof val === 'bigint') return val;
      if (Buffer.isBuffer(val) || val instanceof Uint8Array) {
        let r = BigInt(0);
        for (const b of val) r = (r << BigInt(8)) | BigInt(b);
        return r;
      }
      return BigInt(0);
    }),
    toBytesBE: jest.fn().mockImplementation(val => {
      if (Buffer.isBuffer(val)) return val;
      if (val instanceof Uint8Array) return Buffer.from(val);
      return Buffer.from('00', 'hex');
    }),
  },
}));

const origSetTimeout = global.setTimeout;
const flushPromises = () => new Promise(resolve => origSetTimeout(resolve, 50));

const SUBMISSION_ID_HEX = 'fadf6e0b875978dbb1736de29b95503076d2d07d036daea63ec4c8d1571ff891';
const BRIDGE_ID_HEX = '15db45753160f76964dfa867510c9ede0ac87ac9ce24771de7efa0dab8251c1a';
const RECEIVER_HEX = 'ef4fb24ad0916217251f553c0596f8edc630eb66';

const createRealisticGrpcSendEvent = (nonce: number) => ({
  submissionId: Buffer.from(SUBMISSION_ID_HEX, 'hex'),
  transactionMetadata: {
    transactionHash: Buffer.from(`aa${nonce.toString(16).padStart(2, '0')}`, 'hex'),
    blockNumber: 10 + nonce,
    blockTime: 1677708883,
  },
  submission: {
    targetChainId: 137,
    receiver: Buffer.from(RECEIVER_HEX, 'hex'),
    amountToClaim: 0,
    bridgeId: Buffer.from(BRIDGE_ID_HEX, 'hex'),
    nonce,
  },
  denominator: 0,
});

const createSubmission = (nonce: number): SubmissionEntity => {
  const s = new SubmissionEntity();
  s.submissionId = `0x${SUBMISSION_ID_HEX}`;
  s.txHash = `0xaa${nonce.toString(16).padStart(2, '0')}`;
  s.chainFrom = 7565164;
  s.chainTo = 137;
  s.receiverAddr = `0x${RECEIVER_HEX}`;
  s.amount = '0';
  s.debridgeId = `0x${BRIDGE_ID_HEX}`;
  s.nonce = nonce;
  s.blockNumber = 10 + nonce;
  s.blockTime = '1677708883';
  s.status = 1;
  s.ipfsStatus = 1;
  s.apiStatus = 1;
  s.decimalDenominator = 0;
  s.assetsStatus = 1;
  s.bundlrStatus = 1;
  s.rawEvent = JSON.stringify(createRealisticGrpcSendEvent(nonce));
  return s;
};

const createGrpcEvent = (nonce: number) => ({
  sendEventMessage: {
    oneofKind: 'event' as const,
    event: {
      submission: { nonce },
    },
  },
});

const createRealisticGrpcStreamEvent = (nonce: number) => ({
  sendEventMessage: {
    oneofKind: 'event' as const,
    event: createRealisticGrpcSendEvent(nonce),
  },
});

const createEmptyStream = () => ({
  responses: (async function* () {})(),
});

const createEventStream = (...events: any[]) => ({
  responses: (async function* () {
    for (const event of events) {
      yield event;
    }
  })(),
});

describe('SolanaReaderService', () => {
  let service: SolanaReaderService;
  let processMock: jest.Mock;
  let findOneMock: jest.Mock;
  let updateMock: jest.Mock;
  let transformMock: jest.Mock;
  let getSendEventsMock: jest.Mock;
  const pendingTimers: ReturnType<typeof setTimeout>[] = [];

  beforeEach(() => {
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: any, ms: any, ...args: any[]) => {
      const id = origSetTimeout(fn, ms, ...args);
      pendingTimers.push(id);
      return id;
    }) as any);
  });

  afterEach(() => {
    pendingTimers.forEach(id => clearTimeout(id));
    pendingTimers.length = 0;
    jest.restoreAllMocks();
  });

  async function setupModule(options: {
    stream?: () => any;
    transformResults?: SubmissionEntity[];
    chainData?: Partial<SupportedChainEntity> | null;
    useRealTransformService?: boolean;
  } = {}) {
    processMock = jest.fn().mockResolvedValue(ProcessNewTransferResultStatusEnum.SUCCESS);
    transformMock = jest.fn();

    if (options.transformResults) {
      for (const result of options.transformResults) {
        transformMock.mockReturnValueOnce(result);
      }
    }

    const chainData = options.chainData !== undefined
      ? options.chainData
      : { chainId: 7565164, latestNonce: 0, latestBlock: 0, network: 'solana' };

    findOneMock = jest.fn().mockResolvedValue(chainData);
    updateMock = jest.fn().mockResolvedValue({});
    getSendEventsMock = jest.fn().mockReturnValue(
      options.stream ? options.stream() : createEmptyStream(),
    );

    const mockGrpcClient = {
      getSendEvents: getSendEventsMock,
      abortSignal: undefined as any,
    };

    const transformProvider = options.useRealTransformService
      ? TransformService
      : { provide: TransformService, useValue: { generateSubmissionFromSolanaSendEvent: transformMock } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: getRepositoryToken(SupportedChainEntity),
          useValue: {
            findOne: findOneMock,
            update: updateMock,
          },
        },
        {
          provide: getRepositoryToken(SubmissionEntity),
          useValue: {
            find: jest.fn(),
            update: jest.fn(),
          },
        },
        transformProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(30),
          },
        },
        {
          provide: SubmissionProcessingService,
          useValue: {
            process: processMock,
          },
        },
        {
          provide: SolanaEventsReaderService,
          useValue: {
            getClient: () => mockGrpcClient,
          },
        },
        SolanaReaderService,
      ],
    }).compile();

    service = module.get(SolanaReaderService);
    service.onModuleInit();
    await flushPromises();
  }

  it('syncTransactions returns early when chain is not configured', async () => {
    await setupModule({ chainData: null });

    await service.syncTransactions();
    expect(processMock).not.toHaveBeenCalled();
  });

  it('syncTransactions does nothing when no submissions accumulated', async () => {
    await setupModule();

    await service.syncTransactions();
    expect(processMock).not.toHaveBeenCalled();
  });

  it('syncTransactions processes submissions with all fields from gRPC stream', async () => {
    const sub1 = createSubmission(1);
    const sub2 = createSubmission(2);
    const sub3 = createSubmission(3);

    await setupModule({
      stream: () => createEventStream(
        createGrpcEvent(1),
        createGrpcEvent(2),
        createGrpcEvent(3),
      ),
      transformResults: [sub1, sub2, sub3],
    });

    await service.syncTransactions();

    expect(processMock).toHaveBeenCalledTimes(1);
    const [submissions, chainId, lastNonce] = processMock.mock.calls[0];

    expect(chainId).toBe(7565164);
    expect(lastNonce).toBe(3);
    expect(submissions).toHaveLength(3);

    for (let i = 0; i < 3; i++) {
      const nonce = i + 1;
      const s = submissions[i];
      expect(s.submissionId).toBe(`0x${SUBMISSION_ID_HEX}`);
      expect(s.txHash).toBe(`0xaa${nonce.toString(16).padStart(2, '0')}`);
      expect(s.chainFrom).toBe(7565164);
      expect(s.chainTo).toBe(137);
      expect(s.receiverAddr).toBe(`0x${RECEIVER_HEX}`);
      expect(s.amount).toBe('0');
      expect(s.debridgeId).toBe(`0x${BRIDGE_ID_HEX}`);
      expect(s.nonce).toBe(nonce);
      expect(s.blockNumber).toBe(10 + nonce);
      expect(s.blockTime).toBe('1677708883');
      expect(s.status).toBe(1);
      expect(s.ipfsStatus).toBe(1);
      expect(s.apiStatus).toBe(1);
      expect(s.decimalDenominator).toBe(0);
      expect(s.assetsStatus).toBe(1);
      expect(s.bundlrStatus).toBe(1);
      expect(s.rawEvent).toBeDefined();
      expect(JSON.parse(s.rawEvent)).toHaveProperty('submissionId');
    }
  });

  it('syncTransactions filters submissions by latestNonce', async () => {
    const sub1 = createSubmission(1);
    const sub2 = createSubmission(2);
    const sub3 = createSubmission(3);

    await setupModule({
      stream: () => createEventStream(
        createGrpcEvent(1),
        createGrpcEvent(2),
        createGrpcEvent(3),
      ),
      transformResults: [sub1, sub2, sub3],
      chainData: { chainId: 7565164, latestNonce: 2, latestBlock: 100, network: 'solana' },
    });

    await service.syncTransactions();

    const [submissions] = processMock.mock.calls[0];
    expect(submissions).toHaveLength(2);
    expect(submissions[0].nonce).toBe(2);
    expect(submissions[1].nonce).toBe(3);
  });

  it('syncTransactions sorts submissions by nonce', async () => {
    const sub1 = createSubmission(1);
    const sub3 = createSubmission(3);
    const sub2 = createSubmission(2);

    await setupModule({
      stream: () => createEventStream(
        createGrpcEvent(1),
        createGrpcEvent(3),
        createGrpcEvent(2),
      ),
      transformResults: [sub1, sub3, sub2],
    });

    await service.syncTransactions();

    const [submissions] = processMock.mock.calls[0];
    expect(submissions.map(s => s.nonce)).toEqual([1, 2, 3]);
  });

  it('syncTransactions clears accumulated submissions after processing', async () => {
    const sub1 = createSubmission(1);

    await setupModule({
      stream: () => createEventStream(createGrpcEvent(1)),
      transformResults: [sub1],
    });

    await service.syncTransactions();
    expect(processMock).toHaveBeenCalledTimes(1);

    processMock.mockClear();
    await service.syncTransactions();
    expect(processMock).not.toHaveBeenCalled();
  });

  it('syncTransactions re-subscribes on nonce validation error', async () => {
    const sub1 = createSubmission(1);

    await setupModule({
      stream: () => createEventStream(createGrpcEvent(1)),
      transformResults: [sub1],
    });

    processMock.mockResolvedValue(ProcessNewTransferResultStatusEnum.ERROR_NONCE_VALIDATION);
    getSendEventsMock.mockReturnValue(createEmptyStream());

    await service.syncTransactions();
    await flushPromises();

    expect(processMock).toHaveBeenCalledTimes(1);
    expect(getSendEventsMock).toHaveBeenCalledTimes(2);
  });

  it('syncTransactions re-subscribes on submission validation error', async () => {
    const sub1 = createSubmission(1);

    await setupModule({
      stream: () => createEventStream(createGrpcEvent(1)),
      transformResults: [sub1],
    });

    processMock.mockResolvedValue(ProcessNewTransferResultStatusEnum.ERROR_SUBMISSION_VALIDATION);
    getSendEventsMock.mockReturnValue(createEmptyStream());

    await service.syncTransactions();
    await flushPromises();

    expect(processMock).toHaveBeenCalledTimes(1);
    expect(getSendEventsMock).toHaveBeenCalledTimes(2);
  });

  it('onModuleInit subscribes to gRPC stream with correct nonce', async () => {
    await setupModule({
      chainData: { chainId: 7565164, latestNonce: 42, latestBlock: 100, network: 'solana' },
    });

    expect(getSendEventsMock).toHaveBeenCalledWith(BigInt(42), true);
  });

  it('createSubscription handles heartbeat events and updates block', async () => {
    const heartbeatEvent = {
      sendEventMessage: {
        oneofKind: 'heartbeat' as const,
        heartbeat: {
          resyncLastBlock: '200',
          lastEventBlock: '150',
          rpcLastBlock: '200',
        },
      },
    };

    await setupModule({
      stream: () => createEventStream(heartbeatEvent),
      chainData: {
        chainId: 7565164,
        latestNonce: 0,
        latestBlock: 100,
        lastTransactionSlotNumber: 160,
        network: 'solana',
      },
    });

    expect(updateMock).toHaveBeenCalledWith(7565164, {
      lastTransactionSlotNumber: 200,
      latestBlock: 200,
    });
  });

  describe('integration: real TransformService with gRPC events', () => {
    it('processes realistic gRPC events into correct submission entities', async () => {
      await setupModule({
        useRealTransformService: true,
        stream: () => createEventStream(
          createRealisticGrpcStreamEvent(1),
          createRealisticGrpcStreamEvent(2),
          createRealisticGrpcStreamEvent(3),
        ),
      });

      await service.syncTransactions();

      expect(processMock).toHaveBeenCalledTimes(1);
      const [submissions, chainId, lastNonce] = processMock.mock.calls[0];

      expect(chainId).toBe(7565164);
      expect(lastNonce).toBe(3);
      expect(submissions).toHaveLength(3);

      submissions.forEach((s, i) => {
        const nonce = i + 1;
        expect(s).toBeInstanceOf(SubmissionEntity);
        expect(s.submissionId).toBe(`0x${SUBMISSION_ID_HEX}`);
        expect(s.txHash).toBe(`0xaa${nonce.toString(16).padStart(2, '0')}`);
        expect(s.chainFrom).toBe(7565164);
        expect(s.chainTo).toBe(137);
        expect(s.receiverAddr).toBe(`0x${RECEIVER_HEX}`);
        expect(s.amount).toBe('0');
        expect(s.debridgeId).toBe(`0x${BRIDGE_ID_HEX}`);
        expect(s.nonce).toBe(nonce);
        expect(s.blockNumber).toBe(10 + nonce);
        expect(s.blockTime).toBe('1677708883');
        expect(s.decimalDenominator).toBe(0);
        expect(s.status).toBe(1);
        expect(s.ipfsStatus).toBe(1);
        expect(s.apiStatus).toBe(1);
        expect(s.assetsStatus).toBe(1);
        expect(s.bundlrStatus).toBe(1);

        const rawEvent = JSON.parse(s.rawEvent);
        expect(rawEvent.submission.nonce).toBe(nonce);
        expect(rawEvent.transactionMetadata.blockNumber).toBe(10 + nonce);
        expect(rawEvent.transactionMetadata.blockTime).toBe(1677708883);
      });
    });

    it('filters realistic submissions by latestNonce', async () => {
      await setupModule({
        useRealTransformService: true,
        stream: () => createEventStream(
          createRealisticGrpcStreamEvent(1),
          createRealisticGrpcStreamEvent(2),
          createRealisticGrpcStreamEvent(3),
        ),
        chainData: { chainId: 7565164, latestNonce: 2, latestBlock: 100, network: 'solana' },
      });

      await service.syncTransactions();

      const [submissions] = processMock.mock.calls[0];
      expect(submissions).toHaveLength(2);
      expect(submissions[0].nonce).toBe(2);
      expect(submissions[0].blockNumber).toBe(12);
      expect(submissions[1].nonce).toBe(3);
      expect(submissions[1].blockNumber).toBe(13);
    });
  });
});
