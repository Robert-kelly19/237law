import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class AppService {
  constructor(private prisma: PrismaService) {}

  getHello(): string {
    return `<body style="font-family: Arial, sans-serif; margin: 40px; background-color: #080808; color: #ffffff;">
    <h1>Welcome to the RAG API</h1>
    <p>Use the /rag endpoint to ask questions and the /whatsapp/webhook endpoint for WhatsApp integration.</p>
  </body>`;
  }

  // Example method to get users (uncomment when you have the User model)
  // async getUsers() {
  //   return this.prisma.user.findMany();
  // }
}
