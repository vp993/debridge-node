import { Test, TestingModule } from '@nestjs/testing';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Web3Service } from '../../../../web3/services/Web3Service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SubmissionEntity } from '../../../../../entities/SubmissionEntity';
import { ConfirmNewAssetEntity } from '../../../../../entities/ConfirmNewAssetEntity';
import { CheckAssetsEventAction } from '../CheckAssetsEventAction';
import { ChainConfigService } from '../../../../chain/config/services/ChainConfigService';
import { SolanaEventsReaderService } from '../../../../solana-events-reader/services/SolanaEventsReaderService';
import { DEFAULT_WEB3_TIMEOUT_MS } from '../../../../../utils/parsePositiveInt';

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn().mockReturnValue('{}'),
}));

jest.mock('@debridge-finance/solana-grpc', () => ({
  SolanaGrpcClient: jest.fn(),
  U256Converter: {
    toBigInt: jest.fn().mockImplementation(val => BigInt(val)),
    toBytesBE: jest.fn(),
  },
}));

jest.mock('../../../../../utils/createSolanaPublicKey', () => ({
  createSolanaPublicKey: jest.fn().mockImplementation(val => val),
}));

jest.mock('../../../../../utils/withTimeout', () => ({
  withTimeout: jest.fn().mockImplementation(promise => promise),
}));

const MOCK_HASH = '0x' + 'a'.repeat(64);
const MOCK_SIGNATURE = '0x' + 'b'.repeat(130);

describe('CheckAssetsEventAction', () => {
  let service: CheckAssetsEventAction;
  let findOneConfirmNewAssetEntity;
  let findSubmission;
  let updateSubmission;
  let saveConfirmNewAssetEntity;
  let getChainConfig;
  let getBridgeInfoByBridgeId;
  let getTokenMetadata;
  let mockSoliditySha3Raw: jest.Mock;
  let web3ServiceMock: any;

  beforeEach(async () => {
    mockSoliditySha3Raw = jest.fn().mockReturnValue(MOCK_HASH);
    findSubmission = jest.fn().mockResolvedValue([]);
    findOneConfirmNewAssetEntity = jest.fn().mockResolvedValue(undefined);
    getChainConfig = jest.fn().mockResolvedValue(undefined);
    getBridgeInfoByBridgeId = jest.fn().mockReturnValue({
      response: Promise.resolve({
        nativeChainId: 2,
        nativeTokenAddress: Buffer.from('abcdef0123456789abcdef0123456789abcdef01', 'hex'),
      }),
    });
    getTokenMetadata = jest.fn().mockReturnValue({
      response: Promise.resolve({
        name: 'solana token name',
        symbol: 'sol',
        decimals: 9,
      }),
    });
    updateSubmission = jest.fn().mockResolvedValue(undefined);
    saveConfirmNewAssetEntity = jest.fn().mockResolvedValue(undefined);
    const module: TestingModule = await Test.createTestingModule({
      imports: [HttpModule],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test'),
          },
        },
        CheckAssetsEventAction,
        {
          provide: Web3Service,
          useValue: {
            web3: () => ({
              utils: {
                soliditySha3Raw: mockSoliditySha3Raw,
              },
              eth: {
                accounts: {
                  decrypt: () => ({
                    sign: () => ({ signature: MOCK_SIGNATURE }),
                  }),
                },
              },
            }),
            web3HttpProvider: jest.fn().mockReturnValue({
              eth: {
                Contract: jest.fn().mockImplementation(() => {
                  return {
                    methods: {
                      getDebridge: jest.fn().mockReturnValue({
                        call: jest.fn().mockReturnValue({
                          chainId: 2,
                          tokenAddress: '0xtokenAddress',
                        }),
                      }),
                      getNativeInfo: jest.fn().mockReturnValue({
                        call: jest.fn().mockReturnValue({
                          nativeAddress: '0xnativeAddress',
                          nativeChainId: 2,
                        }),
                      }),
                      name: jest.fn().mockReturnValue({
                        call: jest.fn().mockReturnValue('USDC'),
                      }),
                      symbol: jest.fn().mockReturnValue({
                        call: jest.fn().mockReturnValue('EVM'),
                      }),
                      decimals: jest.fn().mockReturnValue({
                        call: jest.fn().mockReturnValue(18),
                      }),
                    },
                  };
                }),
              },
            }),
          },
        },
        {
          provide: getRepositoryToken(SubmissionEntity),
          useValue: {
            find: findSubmission,
            update: updateSubmission,
          },
        },
        {
          provide: getRepositoryToken(ConfirmNewAssetEntity),
          useValue: {
            findOne: findOneConfirmNewAssetEntity,
            save: saveConfirmNewAssetEntity,
          },
        },
        {
          provide: ChainConfigService,
          useValue: {
            get: getChainConfig,
          },
        },
        {
          provide: SolanaEventsReaderService,
          useValue: {
            getClient: () => ({
              getBridgeInfoByBridgeId,
              getTokenMetadata,
            }),
          },
        },
      ],
    }).compile();
    service = module.get(CheckAssetsEventAction);
    web3ServiceMock = module.get(Web3Service);
  });

  it('no new confirm assets', async () => {
    await service.process();
    expect(findSubmission).toHaveBeenCalledTimes(1);
    expect(updateSubmission).toHaveBeenCalledTimes(0);
    expect(saveConfirmNewAssetEntity).toHaveBeenCalledTimes(0);
  });

  it('process new confirm assets from evm to evm', async () => {
    findSubmission.mockReset().mockReturnValue([
      {
        submissionId: '1',
        debridgeId: '1',
        chainFrom: 1,
        chainTo: 2,
      } as SubmissionEntity,
    ]);
    getChainConfig.mockReset().mockImplementation((chainId: number) => {
      return {
        chainId,
        isSolana: false,
      };
    });
    await service.process();
    expect(findSubmission).toHaveBeenCalledTimes(1);
    expect(updateSubmission).toHaveBeenCalledTimes(1);
    expect(saveConfirmNewAssetEntity).toHaveBeenCalledWith({
      debridgeId: '1',
      submissionTxHash: undefined,
      nativeChainId: 2,
      tokenAddress: '0xnativeAddress',
      name: 'USDC',
      symbol: 'EVM',
      decimals: 18,
      submissionChainFrom: 1,
      submissionChainTo: 2,
      status: 2,
      ipfsStatus: 1,
      apiStatus: 1,
      bundlrStatus: 1,
      signature: MOCK_SIGNATURE,
      deployId: MOCK_HASH,
    });
    expect(mockSoliditySha3Raw).toHaveBeenCalledTimes(3);
    expect(mockSoliditySha3Raw).toHaveBeenNthCalledWith(1, { t: 'string', v: 'USDC' });
    expect(mockSoliditySha3Raw).toHaveBeenNthCalledWith(2, { t: 'string', v: 'EVM' });
    expect(mockSoliditySha3Raw).toHaveBeenNthCalledWith(3,
      { t: 'uint256', v: 2 },
      { t: 'bytes32', v: '1' },
      { t: 'bytes32', v: MOCK_HASH },
      { t: 'bytes32', v: MOCK_HASH },
      { t: 'uint8', v: 18 },
    );
  });

  it('process new confirm assets from evm to solana', async () => {
    findSubmission.mockReset().mockReturnValue([
      {
        submissionId: '1',
        debridgeId: '1',
        chainFrom: 1,
        chainTo: 2,
      } as SubmissionEntity,
    ]);
    getChainConfig.mockReset().mockImplementation((chainId: number) => {
      if (chainId === 1) {
        return {
          isSolana: false,
        };
      } else if (chainId === 2) {
        return {
          isSolana: true,
        };
      }
    });
    await service.process();
    expect(findSubmission).toHaveBeenCalledTimes(1);
    expect(updateSubmission).toHaveBeenCalledTimes(1);
    expect(saveConfirmNewAssetEntity).toHaveBeenCalledWith({
      debridgeId: '1',
      submissionTxHash: undefined,
      nativeChainId: 2,
      tokenAddress: '0xnativeAddress',
      name: 'solana token name',
      symbol: 'sol',
      decimals: 9,
      submissionChainFrom: 1,
      submissionChainTo: 2,
      status: 2,
      ipfsStatus: 1,
      apiStatus: 1,
      bundlrStatus: 1,
      signature: MOCK_SIGNATURE,
      deployId: MOCK_HASH,
    });
    expect(mockSoliditySha3Raw).toHaveBeenCalledTimes(3);
    expect(mockSoliditySha3Raw).toHaveBeenNthCalledWith(1, { t: 'string', v: 'solana token name' });
    expect(mockSoliditySha3Raw).toHaveBeenNthCalledWith(2, { t: 'string', v: 'sol' });
    expect(mockSoliditySha3Raw).toHaveBeenNthCalledWith(3,
      { t: 'uint256', v: 2 },
      { t: 'bytes32', v: '1' },
      { t: 'bytes32', v: MOCK_HASH },
      { t: 'bytes32', v: MOCK_HASH },
      { t: 'uint8', v: 9 },
    );
  });

  it('process new confirm assets from solana to evm', async () => {
    findSubmission.mockReset().mockReturnValue([
      {
        submissionId: '0x1',
        debridgeId: '0x1',
        chainFrom: 1,
        chainTo: 2,
      } as SubmissionEntity,
    ]);
    getChainConfig.mockReset().mockImplementation((chainId: number) => {
      if (chainId === 2) {
        return {
          isSolana: false,
        };
      } else if (chainId === 1) {
        return {
          isSolana: true,
        };
      }
    });
    await service.process();
    expect(findSubmission).toHaveBeenCalledTimes(1);
    expect(updateSubmission).toHaveBeenCalledTimes(1);
    expect(getBridgeInfoByBridgeId).toHaveBeenCalledWith(expect.any(Buffer));
    expect(saveConfirmNewAssetEntity).toHaveBeenCalledWith({
      debridgeId: '0x1',
      submissionTxHash: undefined,
      nativeChainId: 2,
      tokenAddress: '0xabcdef0123456789abcdef0123456789abcdef01',
      name: 'USDC',
      symbol: 'EVM',
      decimals: 18,
      submissionChainFrom: 1,
      submissionChainTo: 2,
      status: 2,
      ipfsStatus: 1,
      apiStatus: 1,
      bundlrStatus: 1,
      signature: MOCK_SIGNATURE,
      deployId: MOCK_HASH,
    });
    expect(mockSoliditySha3Raw).toHaveBeenCalledTimes(3);
    expect(mockSoliditySha3Raw).toHaveBeenNthCalledWith(1, { t: 'string', v: 'USDC' });
    expect(mockSoliditySha3Raw).toHaveBeenNthCalledWith(2, { t: 'string', v: 'EVM' });
    expect(mockSoliditySha3Raw).toHaveBeenNthCalledWith(3,
      { t: 'uint256', v: 2 },
      { t: 'bytes32', v: '0x1' },
      { t: 'bytes32', v: MOCK_HASH },
      { t: 'bytes32', v: MOCK_HASH },
      { t: 'uint8', v: 18 },
    );
  });

  it('process new confirm assets from solana to solana', async () => {
    findSubmission.mockReset().mockReturnValue([
      {
        submissionId: '0x1',
        debridgeId: '0x1',
        chainFrom: 1,
        chainTo: 2,
      } as SubmissionEntity,
    ]);
    getChainConfig.mockReset().mockImplementation(() => {
      return {
        isSolana: true,
      };
    });
    await service.process();
    expect(findSubmission).toHaveBeenCalledTimes(1);
    expect(updateSubmission).toHaveBeenCalledTimes(1);
    expect(getBridgeInfoByBridgeId).toHaveBeenCalledWith(expect.any(Buffer));
    expect(getTokenMetadata).toHaveBeenCalledWith(
      Buffer.from('abcdef0123456789abcdef0123456789abcdef01', 'hex'),
    );
    expect(saveConfirmNewAssetEntity).toHaveBeenCalledWith({
      debridgeId: '0x1',
      submissionTxHash: undefined,
      nativeChainId: 2,
      tokenAddress: '0xabcdef0123456789abcdef0123456789abcdef01',
      name: 'solana token name',
      symbol: 'sol',
      decimals: 9,
      submissionChainFrom: 1,
      submissionChainTo: 2,
      status: 2,
      ipfsStatus: 1,
      apiStatus: 1,
      bundlrStatus: 1,
      signature: MOCK_SIGNATURE,
      deployId: MOCK_HASH,
    });
    expect(mockSoliditySha3Raw).toHaveBeenCalledTimes(3);
    expect(mockSoliditySha3Raw).toHaveBeenNthCalledWith(1, { t: 'string', v: 'solana token name' });
    expect(mockSoliditySha3Raw).toHaveBeenNthCalledWith(2, { t: 'string', v: 'sol' });
    expect(mockSoliditySha3Raw).toHaveBeenNthCalledWith(3,
      { t: 'uint256', v: 2 },
      { t: 'bytes32', v: '0x1' },
      { t: 'bytes32', v: MOCK_HASH },
      { t: 'bytes32', v: MOCK_HASH },
      { t: 'uint8', v: 9 },
    );
  });

  it('process new confirm assets with real data (GPO token on Polygon)', async () => {
    const REAL_DEBRIDGE_ID = '0xbfc394acd6a65c3eddf894116c9ba840710e82127d3ecccf926d417b6aa56308';
    const REAL_TOKEN_ADDRESS = '0x0308a3a9c433256aD7eF24dBEF9c49C8cb01300A';
    const REAL_NATIVE_ADDRESS = '0x0308a3a9c433256ad7ef24dbef9c49c8cb01300a';
    const REAL_DEPLOY_ID = '0x6bfa5c2ba3c71c5f96826597658d8c57668df145ff49f0204c7379105fcb30de';
    const NAME_HASH = '0x' + 'e'.repeat(64);
    const SYMBOL_HASH = '0x' + 'f'.repeat(64);

    findSubmission.mockReset().mockReturnValue([
      {
        submissionId: 'sub-gpo-polygon',
        debridgeId: REAL_DEBRIDGE_ID,
        chainFrom: 137,
        chainTo: 42161,
        txHash: '0xrealtxhash',
      } as SubmissionEntity,
    ]);

    getChainConfig.mockReset().mockImplementation((chainId: number) => {
      return {
        chainId,
        isSolana: false,
      };
    });

    web3ServiceMock.web3HttpProvider.mockReset().mockReturnValue({
      eth: {
        Contract: jest.fn().mockImplementation(() => ({
          methods: {
            getDebridge: jest.fn().mockReturnValue({
              call: jest.fn().mockReturnValue({
                chainId: '137',
                maxAmount: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
                balance: '29970000000000000000',
                lockedInStrategies: '0',
                tokenAddress: REAL_TOKEN_ADDRESS,
                minReservesBps: '10000',
                exist: true,
              }),
            }),
            getNativeInfo: jest.fn().mockReturnValue({
              call: jest.fn().mockReturnValue({
                nativeChainId: '137',
                nativeAddress: REAL_NATIVE_ADDRESS,
              }),
            }),
            name: jest.fn().mockReturnValue({
              call: jest.fn().mockReturnValue('GoldPesa Option'),
            }),
            symbol: jest.fn().mockReturnValue({
              call: jest.fn().mockReturnValue('GPO'),
            }),
            decimals: jest.fn().mockReturnValue({
              call: jest.fn().mockReturnValue(18),
            }),
          },
        })),
      },
    });

    mockSoliditySha3Raw
      .mockReset()
      .mockReturnValueOnce(NAME_HASH)
      .mockReturnValueOnce(SYMBOL_HASH)
      .mockReturnValueOnce(REAL_DEPLOY_ID);

    await service.process();

    expect(findSubmission).toHaveBeenCalledTimes(1);
    expect(updateSubmission).toHaveBeenCalledTimes(1);

    expect(mockSoliditySha3Raw).toHaveBeenCalledTimes(3);
    expect(mockSoliditySha3Raw).toHaveBeenNthCalledWith(1, { t: 'string', v: 'GoldPesa Option' });
    expect(mockSoliditySha3Raw).toHaveBeenNthCalledWith(2, { t: 'string', v: 'GPO' });
    expect(mockSoliditySha3Raw).toHaveBeenNthCalledWith(3,
      { t: 'uint256', v: 2 },
      { t: 'bytes32', v: REAL_DEBRIDGE_ID },
      { t: 'bytes32', v: NAME_HASH },
      { t: 'bytes32', v: SYMBOL_HASH },
      { t: 'uint8', v: 18 },
    );

    expect(saveConfirmNewAssetEntity).toHaveBeenCalledWith({
      debridgeId: REAL_DEBRIDGE_ID,
      submissionTxHash: '0xrealtxhash',
      nativeChainId: '137',
      tokenAddress: REAL_NATIVE_ADDRESS,
      name: 'GoldPesa Option',
      symbol: 'GPO',
      decimals: 18,
      submissionChainFrom: 137,
      submissionChainTo: 42161,
      status: 2,
      ipfsStatus: 1,
      apiStatus: 1,
      bundlrStatus: 1,
      signature: MOCK_SIGNATURE,
      deployId: REAL_DEPLOY_ID,
    });
  });

  /**
   * Regression for the WEB3_TIMEOUT=NaN bug: docker-compose passes
   * `WEB3_TIMEOUT=${WEB3_TIMEOUT}` into the container, and when the host var
   * is unset ConfigService returns '' (default only applies to `undefined`).
   * Naive parseInt yields NaN, and setTimeout(fn, NaN) fires immediately,
   * so every RPC call is reported as timed out. We guarantee rpcTimeout is
   * always a positive integer regardless of env input.
   */
  describe('WEB3_TIMEOUT parsing', () => {
    const buildWith = async (raw: string | undefined): Promise<CheckAssetsEventAction> => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [HttpModule],
        providers: [
          {
            provide: ConfigService,
            useValue: { get: (key: string) => (key === 'WEB3_TIMEOUT' ? raw : undefined) },
          },
          CheckAssetsEventAction,
          {
            provide: Web3Service,
            useValue: { web3: () => ({ eth: { accounts: { decrypt: () => ({}) } } }) },
          },
          { provide: getRepositoryToken(SubmissionEntity), useValue: {} },
          { provide: getRepositoryToken(ConfirmNewAssetEntity), useValue: {} },
          { provide: ChainConfigService, useValue: {} },
          { provide: SolanaEventsReaderService, useValue: { getClient: () => ({}) } },
        ],
      }).compile();
      return module.get(CheckAssetsEventAction);
    };

    const getTimeout = (a: CheckAssetsEventAction): number => (a as any).rpcTimeout;

    it.each<[string | undefined, string]>([
      [undefined, 'not set in .env'],
      ['', 'empty (docker-compose pass-through of unset host var)'],
      ['   ', 'only whitespace'],
      ['abc', 'non-numeric'],
      ['0', 'zero'],
      ['-1', 'negative'],
    ])('falls back to DEFAULT_WEB3_TIMEOUT_MS when WEB3_TIMEOUT is %j (%s)', async (raw) => {
      expect(getTimeout(await buildWith(raw))).toBe(DEFAULT_WEB3_TIMEOUT_MS);
    });

    it('uses WEB3_TIMEOUT verbatim when it is a valid positive integer', async () => {
      expect(getTimeout(await buildWith('45000'))).toBe(45000);
    });

    it('never produces NaN (regression: setTimeout(fn, NaN) fires immediately)', async () => {
      for (const raw of [undefined, '', '   ', 'abc', '10s']) {
        const t = getTimeout(await buildWith(raw));
        expect(Number.isNaN(t)).toBe(false);
        expect(t).toBeGreaterThan(0);
      }
    });
  });
});
