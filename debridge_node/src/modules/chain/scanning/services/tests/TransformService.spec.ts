import { TransformService } from '../TransformService';
import { SubmissionEntity } from '../../../../../entities/SubmissionEntity';
import { SubmisionStatusEnum } from '../../../../../enums/SubmisionStatusEnum';
import { UploadStatusEnum } from '../../../../../enums/UploadStatusEnum';
import { SubmisionAssetsStatusEnum } from '../../../../../enums/SubmisionAssetsStatusEnum';
import { BundlrStatusEnum } from '../../../../../enums/BundlrStatusEnum';

jest.mock('@debridge-finance/solana-grpc', () => ({
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

// Solana signature: 64 bytes (128 hex chars)
const SOLANA_TX_SIGNATURE = Buffer.from(
  '5f4d76a29c6de7b84e532e8da4b6c5c3f9a2b8d1e0c7f6a5d4b3c2e1f0a9b8c7' +
  'd6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5',
  'hex',
);

// bytes32 values: 32 bytes (64 hex chars)
const SUBMISSION_ID_BYTES = Buffer.from(
  'fadf6e0b875978dbb1736de29b95503076d2d07d036daea63ec4c8d1571ff891',
  'hex',
);
const BRIDGE_ID_BYTES = Buffer.from(
  '15db45753160f76964dfa867510c9ede0ac87ac9ce24771de7efa0dab8251c1a',
  'hex',
);

// EVM address: 20 bytes (40 hex chars)
const RECEIVER_BYTES = Buffer.from('ef4fb24ad0916217251f553c0596f8edc630eb66', 'hex');

const SUBMISSION_ID_HEX = SUBMISSION_ID_BYTES.toString('hex');
const BRIDGE_ID_HEX = BRIDGE_ID_BYTES.toString('hex');
const RECEIVER_HEX = RECEIVER_BYTES.toString('hex');
const SOLANA_TX_HEX = SOLANA_TX_SIGNATURE.toString('hex');

const createSolanaSendEvent = (overrides: Record<string, any> = {}) => ({
  submissionId: SUBMISSION_ID_BYTES,
  transactionMetadata: {
    transactionHash: SOLANA_TX_SIGNATURE,
    blockNumber: 251_632_417,
    blockTime: 1713200000,
  },
  submission: {
    targetChainId: 137,
    receiver: RECEIVER_BYTES,
    amountToClaim: 1_500_000_000,
    bridgeId: BRIDGE_ID_BYTES,
    nonce: 42,
  },
  denominator: 6,
  ...overrides,
});

// EVM: all hashes/ids are bytes32 strings (0x + 64 hex), addresses are 0x + 40 hex
const EVM_TX_HASH = '0x9a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b';
const EVM_SUBMISSION_ID = '0xaabbccdd11223344556677889900aabbccdd11223344556677889900aabbccdd';
const EVM_DEBRIDGE_ID = '0x1122334455667788990011223344556677889900112233445566778899001122';
const EVM_RECEIVER = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';

const createEvmSentEvent = (overrides: Record<string, any> = {}) => ({
  returnValues: {
    submissionId: EVM_SUBMISSION_ID,
    chainIdFrom: 1,
    chainIdTo: 56,
    debridgeId: EVM_DEBRIDGE_ID,
    receiver: EVM_RECEIVER,
    amount: '25000000000000000000',
    nonce: '117',
    ...(overrides.returnValues || {}),
  },
  transactionHash: EVM_TX_HASH,
  blockNumber: 19_542_381,
  ...overrides,
});

describe('TransformService', () => {
  let transformService: TransformService;

  beforeEach(() => {
    transformService = new TransformService();
  });

  describe('generateSubmissionFromSolanaSendEvent', () => {
    it('should generate submission from Solana send event', () => {
      const event = createSolanaSendEvent();
      const submission = transformService.generateSubmissionFromSolanaSendEvent(event);

      expect(submission).toBeInstanceOf(SubmissionEntity);
      expect(submission.submissionId).toBe(`0x${SUBMISSION_ID_HEX}`);
      expect(submission.txHash).toBe(`0x${SOLANA_TX_HEX}`);
      expect(submission.chainFrom).toBe(7565164);
      expect(submission.chainTo).toBe(137);
      expect(submission.receiverAddr).toBe(`0x${RECEIVER_HEX}`);
      expect(submission.amount).toBe('1500000000');
      expect(submission.debridgeId).toBe(`0x${BRIDGE_ID_HEX}`);
      expect(submission.nonce).toBe(42);
      expect(submission.blockNumber).toBe(251_632_417);
      expect(submission.blockTime).toBe('1713200000');
      expect(submission.decimalDenominator).toBe(6);
      expect(submission.rawEvent).toBe(JSON.stringify(event));
    });

    it('should set all statuses to NEW', () => {
      const event = createSolanaSendEvent();
      const submission = transformService.generateSubmissionFromSolanaSendEvent(event);

      expect(submission.status).toBe(SubmisionStatusEnum.NEW);
      expect(submission.ipfsStatus).toBe(UploadStatusEnum.NEW);
      expect(submission.apiStatus).toBe(UploadStatusEnum.NEW);
      expect(submission.assetsStatus).toBe(SubmisionAssetsStatusEnum.NEW);
      expect(submission.bundlrStatus).toBe(BundlrStatusEnum.NEW);
    });

    it('should handle zero amount', () => {
      const event = createSolanaSendEvent({
        submission: {
          ...createSolanaSendEvent().submission,
          amountToClaim: 0,
        },
      });
      const submission = transformService.generateSubmissionFromSolanaSendEvent(event);
      expect(submission.amount).toBe('0');
    });

    it('should handle large nonce values', () => {
      const event = createSolanaSendEvent({
        submission: {
          ...createSolanaSendEvent().submission,
          nonce: 999999,
        },
      });
      const submission = transformService.generateSubmissionFromSolanaSendEvent(event);
      expect(submission.nonce).toBe(999999);
    });

    it('should handle different target chains', () => {
      const event = createSolanaSendEvent({
        submission: {
          ...createSolanaSendEvent().submission,
          targetChainId: 56,
        },
      });
      const submission = transformService.generateSubmissionFromSolanaSendEvent(event);
      expect(submission.chainTo).toBe(56);
      expect(submission.chainFrom).toBe(7565164);
    });

    it('should serialize rawEvent as JSON', () => {
      const event = createSolanaSendEvent();
      const submission = transformService.generateSubmissionFromSolanaSendEvent(event);
      const parsed = JSON.parse(submission.rawEvent);
      expect(parsed.submission.nonce).toBe(event.submission.nonce);
    });
  });

  describe('generateSubmissionFromSentEvent', () => {
    it('should generate submission from EVM sent event', () => {
      const event = createEvmSentEvent();
      const submission = transformService.generateSubmissionFromSentEvent(event);

      expect(submission.submissionId).toBe(EVM_SUBMISSION_ID);
      expect(submission.txHash).toBe(EVM_TX_HASH);
      expect(submission.chainFrom).toBe(1);
      expect(submission.chainTo).toBe(56);
      expect(submission.debridgeId).toBe(EVM_DEBRIDGE_ID);
      expect(submission.receiverAddr).toBe(EVM_RECEIVER);
      expect(submission.amount).toBe('25000000000000000000');
      expect(submission.nonce).toBe(117);
      expect(submission.blockNumber).toBe(19_542_381);
      expect(submission.rawEvent).toBe(JSON.stringify(event));
    });

    it('should set all statuses to NEW', () => {
      const event = createEvmSentEvent();
      const submission = transformService.generateSubmissionFromSentEvent(event);

      expect(submission.status).toBe(SubmisionStatusEnum.NEW);
      expect(submission.ipfsStatus).toBe(UploadStatusEnum.NEW);
      expect(submission.apiStatus).toBe(UploadStatusEnum.NEW);
      expect(submission.assetsStatus).toBe(SubmisionAssetsStatusEnum.NEW);
      expect(submission.bundlrStatus).toBe(BundlrStatusEnum.NEW);
    });

    it('should parse nonce as integer from string', () => {
      const event = createEvmSentEvent({ returnValues: { nonce: '9001' } });
      const submission = transformService.generateSubmissionFromSentEvent(event);
      expect(submission.nonce).toBe(9001);
      expect(typeof submission.nonce).toBe('number');
    });

    it('should correctly transform a real production Sent event (Linea → Base)', () => {
      const realEvent = {
        address: '0x43dE2d77BF8027e25dBD179B491e8d64f38398aA',
        blockNumber: 16383380,
        transactionHash: '0x4ae7467163ba83c93f7d89099cad7a21ca801b8575fc3863ca61bf040021ddf8',
        transactionIndex: 1,
        blockHash: '0x5c64b0ccbbaf059c37d3f7cff7b24383909c7f2092a8b9a7ddb8fc6bb7c780de',
        blockTimestamp: '0x69e1462a',
        logIndex: 3,
        removed: false,
        id: 'log_ce0bb03a',
        returnValues: {
          '0': '0x379d1e07632c3af6a1bd128fb0a12a6a531cd3ec7ec9955dcb9275920785b8cf',
          '1': '0x434e0f7ed1621c9abd92db3de71250fbfe6b18e301c92aaf6c04cfdacb339756',
          '2': '0',
          '3': '0x6b8e8924d1ccdbca5efaddaea60534cc510e299b',
          '4': '2788',
          '5': '8453',
          '6': '4850',
          '7': ['0', '10000000000000000', '0', false, false],
          '8': '0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000000146b8e8924d1ccdbca5efaddaea60534cc510e299b0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
          '9': '0x02223227de2Aed9880Bbc019F212Ea8BABD811E4',
          submissionId: '0x379d1e07632c3af6a1bd128fb0a12a6a531cd3ec7ec9955dcb9275920785b8cf',
          debridgeId: '0x434e0f7ed1621c9abd92db3de71250fbfe6b18e301c92aaf6c04cfdacb339756',
          amount: '0',
          receiver: '0x6b8e8924d1ccdbca5efaddaea60534cc510e299b',
          nonce: '2788',
          chainIdTo: '8453',
          chainIdFrom: 59144,
          referralCode: '4850',
          feeParams: ['0', '10000000000000000', '0', false, false],
          autoParams:
            '0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000000146b8e8924d1ccdbca5efaddaea60534cc510e299b0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
          nativeSender: '0x02223227de2Aed9880Bbc019F212Ea8BABD811E4',
        },
        event: 'Sent',
        signature: '0xe315721819a1f353fe56de404206bdd896ab5edc7822f1804a8c4c2c4788174c',
        raw: {
          data: '0x379d1e07632c3af6a1bd128fb0a12a6a531cd3ec7ec9955dcb9275920785b8cf000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000000ae400000000000000000000000000000000000000000000000000000000000021050000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002386f26fc1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001c000000000000000000000000002223227de2aed9880bbc019f212ea8babd811e400000000000000000000000000000000000000000000000000000000000000146b8e8924d1ccdbca5efaddaea60534cc510e299b0000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000000146b8e8924d1ccdbca5efaddaea60534cc510e299b0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
          topics: [
            '0xe315721819a1f353fe56de404206bdd896ab5edc7822f1804a8c4c2c4788174c',
            '0x434e0f7ed1621c9abd92db3de71250fbfe6b18e301c92aaf6c04cfdacb339756',
            '0x0000000000000000000000000000000000000000000000000000000000002105',
          ],
        },
      };

      const submission = transformService.generateSubmissionFromSentEvent(realEvent);

      expect(submission.submissionId).toBe(
        '0x379d1e07632c3af6a1bd128fb0a12a6a531cd3ec7ec9955dcb9275920785b8cf',
      );
      expect(submission.txHash).toBe(
        '0x4ae7467163ba83c93f7d89099cad7a21ca801b8575fc3863ca61bf040021ddf8',
      );
      expect(submission.debridgeId).toBe(
        '0x434e0f7ed1621c9abd92db3de71250fbfe6b18e301c92aaf6c04cfdacb339756',
      );
      expect(submission.receiverAddr).toBe('0x6b8e8924d1ccdbca5efaddaea60534cc510e299b');
      expect(submission.amount).toBe('0');
      expect(submission.nonce).toBe(2788);
      expect(typeof submission.nonce).toBe('number');
      expect(submission.blockNumber).toBe(16383380);

      expect(submission.chainFrom).toBe(59144);
      // web3.js returns uint256 event params as strings;
      // chainIdTo is NOT converted to number by TransformService
      expect(submission.chainTo).toBe('8453' as any);

      expect(submission.status).toBe(SubmisionStatusEnum.NEW);
      expect(submission.ipfsStatus).toBe(UploadStatusEnum.NEW);
      expect(submission.apiStatus).toBe(UploadStatusEnum.NEW);
      expect(submission.assetsStatus).toBe(SubmisionAssetsStatusEnum.NEW);
      expect(submission.bundlrStatus).toBe(BundlrStatusEnum.NEW);

      expect(JSON.parse(submission.rawEvent)).toEqual(realEvent);
    });
  });
});
