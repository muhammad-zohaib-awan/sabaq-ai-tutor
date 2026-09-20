import { Global, Module } from '@nestjs/common';
import { ConfigController } from './config.controller';
import { EngineConfigService } from './engine-config.service';

@Global()
@Module({
  controllers: [ConfigController],
  providers: [EngineConfigService],
  exports: [EngineConfigService],
})
export class EngineConfigModule {}
