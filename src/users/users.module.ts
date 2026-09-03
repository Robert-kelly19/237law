import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { PlatformUserService } from './platform-user.service';

@Module({
  imports: [PrismaModule],
  providers: [PlatformUserService],
  exports: [PlatformUserService],
})
export class UsersModule {}
