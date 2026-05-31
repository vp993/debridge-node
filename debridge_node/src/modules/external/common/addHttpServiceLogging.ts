import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { sanitizeRequestConfigForLogging } from './sanitizeHttpLogging';

export const addHttpServiceLogging = (httpService: HttpService, logger: Logger) => {
  httpService.axiosRef.interceptors.request.use(
    request => {
      logger.verbose(`Http request ${JSON.stringify(sanitizeRequestConfigForLogging(request))}`);
      return request;
    },
    request => {
      logger.error(`Http request ${JSON.stringify(request.message)}`);
      return Promise.reject(request);
    },
  );
  httpService.axiosRef.interceptors.response.use(
    response => {
      logger.verbose(
        `Http response config: ${JSON.stringify(sanitizeRequestConfigForLogging(response.config))} status: ${response.status} statusText: ${
          response.statusText
        } headers: ${JSON.stringify(response.headers)} data: ${JSON.stringify(response.data)}`,
      );
      return response;
    },
    response => {
      const sanitized =
        response && typeof response === 'object' && 'config' in response
          ? { ...response, config: sanitizeRequestConfigForLogging((response as any).config) }
          : response;
      logger.error(`Http response ${JSON.stringify(sanitized)}`);
      return Promise.reject(response);
    },
  );
};
