import {
  Body,
  Controller,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AdminAuthGuard } from './admin-auth.guard';
import { BroadcastDto } from './admin-broadcast.dto';
import { AdminBroadcastService } from './admin-broadcast.service';

@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminBroadcastController {
  constructor(private readonly broadcastService: AdminBroadcastService) {}

  @Post('broadcast')
  async broadcast(@Body(new ValidationPipe({ transform: true })) dto: BroadcastDto) {
    return this.broadcastService.sendBroadcast(dto.message.trim());
  }
}
