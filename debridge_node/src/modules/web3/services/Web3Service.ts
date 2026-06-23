import { Injectable, Logger } from '@nestjs/common';
import Web3 from 'web3';
import { ConfigService } from '@nestjs/config';
import { abi as deBridgeGateAbi } from '../../../assets/DeBridgeGate.json';
import { EvmChainConfig } from '../../chain/config/models/configs/EvmChainConfig';
import { maskRpcUrl, maskRpcUrls } from '../../../utils/maskRpcUrl';
import { DEFAULT_WEB3_TIMEOUT_MS, parsePositiveInt } from '../../../utils/parsePositiveInt';

export class Web3Custom extends Web3 {
  constructor(
    readonly chainProvider: string,
    httpProvider,
  ) {
    super(httpProvider);
  }
}

@Injectable()
export class Web3Service {
  private readonly providersMap = new Map<string, Web3Custom>();
  private readonly logger = new Logger(Web3Service.name);
  private readonly web3Timeout: number;

  constructor(private readonly configService: ConfigService) {
    this.web3Timeout = parsePositiveInt(configService.get('WEB3_TIMEOUT'), DEFAULT_WEB3_TIMEOUT_MS);
  }

  web3(): Web3 {
    return new Web3();
  }

  /**
   * Wraps HttpProvider.send with an application-level timeout guard.
   * The built-in HttpProvider `timeout` option only sets xhr.timeout,
   * which does NOT fire when the TCP socket is open but the node never responds
   * (keep-alive hang). This wrapper guarantees the callback fires within `ms`.
   */
  private createHttpProvider(url: string, options: Record<string, any>): InstanceType<typeof Web3Custom.providers.HttpProvider> {
    const httpProvider = new Web3Custom.providers.HttpProvider(url, options);
    const timeoutMs = this.web3Timeout;
    const originalSend = httpProvider.send.bind(httpProvider);

    httpProvider.send = (payload: any, callback: any) => {
      let done = false;

      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          callback(new Error(`RPC request timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      originalSend(payload, (err: any, result: any) => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          callback(err, result);
        }
      });
    };

    return httpProvider;
  }

  async web3HttpProvider(chainConfig: EvmChainConfig, excludedProviders = new Set<string>()): Promise<Web3Custom> {
    const chainProvider = chainConfig.providers;
    const providers = [...chainProvider.getNotFailedProviders(), ...chainProvider.getFailedProviders()].filter(
      provider => !excludedProviders.has(provider),
    );

    for (const provider of providers) {
      if (this.providersMap.has(provider)) {
        const web3 = this.providersMap.get(provider);
        const isWorking = await this.checkConnectionHttpProvider(web3);
        if (isWorking) {
          this.logger.verbose(`Old provider is working`);
          return web3;
        }
        this.logger.error(`Old provider ${maskRpcUrl(provider)} is not working`);
      }

      const httpProvider = this.createHttpProvider(provider, {
        timeout: this.web3Timeout,
        keepAlive: true,
        headers: chainProvider.getChainAuth(provider),
      });

      const web3 = new Web3Custom(provider, httpProvider);
      const isWorking = await this.checkConnectionHttpProvider(web3);

      if (!isWorking) {
        chainProvider.setProviderStatus(provider, false);
        continue;
      }
      if (!chainProvider.getProviderValidationStatus(provider)) {
        await this.validateChainId(chainConfig, provider);
      }
      chainProvider.setProviderStatus(provider, true);
      this.providersMap.set(provider, web3);
      return web3;
    }
    const err = `Cann't connect to any provider ${maskRpcUrls(chainProvider.getAllProviders())}`;
    this.logger.error(err);
    throw new Error(err);
  }

  private async checkConnectionHttpProvider(web3: Web3Custom): Promise<boolean> {
    const provider = web3.chainProvider;
    const maskedProvider = maskRpcUrl(provider);
    try {
      this.logger.log(`Connection to ${maskedProvider} is started`);
      await web3.eth.getBlockNumber();
      this.logger.log(`Connection to ${maskedProvider} is success`);
      return true;
    } catch (e) {
      this.logger.error(`Cann't connect to ${maskedProvider}: ${e.message}`);
      this.logger.error(e);
    }
    return false;
  }

  async validateChainId(chainConfig: EvmChainConfig, provider: string) {
    const chainProvider = chainConfig.providers;
    try {
      const httpProvider = this.createHttpProvider(provider, {
        timeout: this.web3Timeout,
        keepAlive: false,
        headers: chainProvider.getChainAuth(provider),
      });
      const web3 = new Web3Custom(provider, httpProvider);
      const contractInstance = new web3.eth.Contract(deBridgeGateAbi as any, chainConfig.debridgeAddr);
      // @ts-expect-error web3 setProvider is reassigned to the contract provider for existing call sites.
      web3.eth.setProvider = contractInstance.setProvider;

      const contractChainId = Number(await contractInstance.methods.getChainId().call());
      if (contractChainId !== chainProvider.getChainId()) {
        this.logger.error(`Checking correct RPC from config is failed (in config ${chainProvider.getChainId()} in contract ${contractChainId})`);
        process.exit(1);
      }
      chainProvider.setProviderValidationStatus(provider, true);
    } catch (error) {
      this.logger.error(`Catch error: ${error}; provider: ${maskRpcUrl(provider)}`);
    }
  }
}
