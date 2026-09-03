import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PlatformUserService } from './platform-user.service';

@Module({
  providers: [PrismaService, PlatformUserService],
  exports: [PlatformUserService],
})
export class UsersModule {}
