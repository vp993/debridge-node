import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SubmissionEntity } from '../../../../../entities/SubmissionEntity';
import { ConfirmNewAssetEntity } from '../../../../../entities/ConfirmNewAssetEntity';
import { SignAction } from '../SignAction';
import { Repository } from 'typeorm';
import { SubmisionStatusEnum } from '../../../../../enums/SubmisionStatusEnum';
import { Web3Service } from '../../../../web3/services/Web3Service';
import Web3 from 'web3';
import { readFileSync } from 'fs';

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn().mockReturnValue('{}'),
}));

const mockedReadFileSync = readFileSync as jest.Mock;

// fake test key — NOT a real private key
const TEST_PRIVATE_KEY =
  '0x18e257c72562d106d4faa68b480829b9c374fcdf795ab2a16199a393137e6c5d';
const TEST_SUBMISSION_ID =
  '0x7254a2b842619ebabe8c4cfaf7849fd5c4162540e662acc58bcf84e9d2092b61';
const KEYSTORE_PASSWORD = 'test-password';

describe('SignAction (mocked)', () => {
  let service: SignAction;
  let repository: Repository<SubmissionEntity>;

  beforeEach(async () => {
    mockedReadFileSync.mockReturnValue('{}');

    const module: TestingModule = await Test.createTestingModule({
      imports: [HttpModule],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test'),
          },
        },
        SignAction,
        {
          provide: Web3Service,
          useValue: {
            web3: () => ({
              eth: {
                accounts: {
                  decrypt: () => ({
                    sign: (data: string) => ({ signature: data }),
                  }),
                },
              },
            }),
          },
        },
        {
          provide: getRepositoryToken(SubmissionEntity),
          useValue: {
            find: async () => [{ submissionId: '123' }],
            update: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: getRepositoryToken(ConfirmNewAssetEntity),
          useValue: {
            find: async () => [],
          },
        },
      ],
    }).compile();

    service = module.get(SignAction);
    repository = module.get(getRepositoryToken(SubmissionEntity));
  });

  it('signs submissions and updates their status', async () => {
    await service.process();
    expect(repository.update).toHaveBeenCalledWith(
      { submissionId: '123' },
      { signature: '123', status: SubmisionStatusEnum.SIGNED },
    );
  });
});

describe('SignAction (real signature)', () => {
  let service: SignAction;
  let repository: Repository<SubmissionEntity>;
  let web3: Web3;
  let expectedAddress: string;

  beforeEach(async () => {
    web3 = new Web3();
    const account = web3.eth.accounts.privateKeyToAccount(TEST_PRIVATE_KEY);
    expectedAddress = account.address;

    const keystore = web3.eth.accounts.encrypt(TEST_PRIVATE_KEY, KEYSTORE_PASSWORD);
    mockedReadFileSync.mockReturnValue(JSON.stringify(keystore));

    const module: TestingModule = await Test.createTestingModule({
      imports: [HttpModule],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(KEYSTORE_PASSWORD),
          },
        },
        SignAction,
        {
          provide: Web3Service,
          useValue: {
            web3: () => new Web3(),
          },
        },
        {
          provide: getRepositoryToken(SubmissionEntity),
          useValue: {
            find: async () => [{ submissionId: TEST_SUBMISSION_ID }],
            update: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: getRepositoryToken(ConfirmNewAssetEntity),
          useValue: {
            find: async () => [],
          },
        },
      ],
    }).compile();

    service = module.get(SignAction);
    repository = module.get(getRepositoryToken(SubmissionEntity));
  });

  it('produces a valid ECDSA signature recoverable to the signer address', async () => {
    await service.process();

    expect(repository.update).toHaveBeenCalledTimes(1);
    expect(repository.update).toHaveBeenCalledWith(
      { submissionId: TEST_SUBMISSION_ID },
      {
        signature: expect.any(String),
        status: SubmisionStatusEnum.SIGNED,
      },
    );

    const updateCall = (repository.update as jest.Mock).mock.calls[0];
    const { signature } = updateCall[1];

    const recoveredAddress = web3.eth.accounts.recover(
      TEST_SUBMISSION_ID,
      signature,
    );
    expect(recoveredAddress.toLowerCase()).toBe(expectedAddress.toLowerCase());
  });
});
