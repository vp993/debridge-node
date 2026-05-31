import { Module } from '@nestjs/common';
import { MonitoringHandler } from './MonitoringHandler';

@Module({
  providers: [MonitoringHandler],
})
export class MonitoringModule {}
