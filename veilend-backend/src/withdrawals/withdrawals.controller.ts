import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Req,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { WithdrawalStatus } from '@prisma/client';
import { PageOptionsDto } from '../common/dto/page-options.dto';
import type { Request } from 'express';

interface AuthenticatedUser {
  walletAddress: string;
  sessionId: string;
  expiresAt: Date;
}

interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

@Controller('withdrawals')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  /**
   * Create a new withdrawal request.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createWithdrawal(
    @Body() dto: CreateWithdrawalDto,
    @Req() req: RequestWithUser,
  ) {
    return this.withdrawalsService.createWithdrawal(
      req.user.sessionId, // Will be replaced with actual userId
      req.user.walletAddress,
      dto,
    );
  }

  /**
   * Get all withdrawals for the authenticated user.
   */
  @Get()
  async getUserWithdrawals(
    @Query() pageOptions: PageOptionsDto,
    @Query('status') status?: string,
    @Req() req?: RequestWithUser,
  ) {
    return this.withdrawalsService.getUserWithdrawals(
      req!.user.sessionId, // Will be replaced with actual userId
      {
        status: status ? (status as WithdrawalStatus) : undefined,
        take: pageOptions.take,
        skip: pageOptions.skip,
      },
    );
  }

  /**
   * Get a single withdrawal by ID.
   */
  @Get(':id')
  async getWithdrawalById(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
  ) {
    return this.withdrawalsService.getWithdrawalById(
      id,
      req.user.sessionId, // Will be replaced with actual userId
    );
  }

  /**
   * Sign a withdrawal request with the XDR.
   */
  @Post(':id/sign')
  @HttpCode(HttpStatus.ACCEPTED)
  async signWithdrawal(
    @Param('id') id: string,
    @Body() body: { xdr: string; txHash: string },
    @Req() req: RequestWithUser,
  ) {
    return this.withdrawalsService.signWithdrawal(
      id,
      req.user.sessionId, // Will be replaced with actual userId
      body.xdr,
      body.txHash,
    );
  }

  /**
   * Submit withdrawal to the network.
   */
  @Post(':id/submit')
  @HttpCode(HttpStatus.ACCEPTED)
  async submitWithdrawal(
    @Param('id') id: string,
    @Body() body: { txHash: string },
    @Req() req: RequestWithUser,
  ) {
    return this.withdrawalsService.submitWithdrawal(
      id,
      req.user.sessionId, // Will be replaced with actual userId
      body.txHash,
    );
  }

  /**
   * Cancel a withdrawal request.
   */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.ACCEPTED)
  async cancelWithdrawal(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.withdrawalsService.cancelWithdrawal(
      id,
      req.user.sessionId, // Will be replaced with actual userId
    );
  }

  /**
   * Get pending withdrawals (admin endpoint).
   */
  @Get('admin/pending')
  async getPendingWithdrawals() {
    return this.withdrawalsService.getPendingWithdrawals();
  }

  /**
   * Add address to whitelist.
   */
  @Post('whitelist')
  @HttpCode(HttpStatus.CREATED)
  async addToWhitelist(
    @Body()
    body: {
      address: string;
      label?: string;
      instantMode?: boolean;
      instantLimitUsd?: number;
    },
    @Req() req: RequestWithUser,
  ) {
    return this.withdrawalsService.addToWhitelist(
      req.user.sessionId, // Will be replaced with actual userId
      body.address,
      body.label,
      body.instantMode,
      body.instantLimitUsd,
    );
  }

  /**
   * Get user's whitelist.
   */
  @Get('whitelist')
  async getWhitelist(@Req() req: RequestWithUser) {
    return this.withdrawalsService.getWhitelist(
      req.user.sessionId, // Will be replaced with actual userId
    );
  }

  /**
   * Remove address from whitelist.
   */
  @Delete('whitelist/:id')
  @HttpCode(HttpStatus.ACCEPTED)
  async removeFromWhitelist(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
  ) {
    return this.withdrawalsService.removeFromWhitelist(
      req.user.sessionId, // Will be replaced with actual userId
      id,
    );
  }
}
