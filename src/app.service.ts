import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class AppService {
  constructor(private prisma: PrismaService) {}

  getHello(): string {
    return 'Hello World!';
  }

  // Example method to get users (uncomment when you have the User model)
  // async getUsers() {
  //   return this.prisma.user.findMany();
  // }
}
