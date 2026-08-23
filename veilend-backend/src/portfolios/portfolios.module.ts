import { Module } from '@nestjs/common';
import { PortfoliosController } from './portfolios.controller';
import { PortfoliosService } from './portfolios.service';
import { PortfoliosRepository } from './portfolios.repository';
import { AuthModule } from '../auth/auth.module';
import { StellarModule } from '../stellar/stellar.module';
import { ProtocolModule } from '../protocol/protocol.module';

@Module({
  imports: [AuthModule, StellarModule, ProtocolModule],
  controllers: [PortfoliosController],
  providers: [PortfoliosService, PortfoliosRepository],
})
export class PortfoliosModule {}
