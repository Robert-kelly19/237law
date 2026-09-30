import { Test, TestingModule } from '@nestjs/testing';
import { AdminBroadcastService } from './admin-broadcast.service';
import { PrismaService } from '../prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

describe('AdminBroadcastService', () => {
  let service: AdminBroadcastService;
  let prisma: { platformUser: { findMany: jest.Mock } };
  let whatsappService: { send: jest.Mock };

  beforeEach(async () => {
    prisma = {
      platformUser: {
        findMany: jest.fn(),
      },
    };

    whatsappService = {
      send: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminBroadcastService,
        { provide: PrismaService, useValue: prisma },
        { provide: WhatsappService, useValue: whatsappService },
      ],
    }).compile();

    service = module.get<AdminBroadcastService>(AdminBroadcastService);
  });

  it('should send to all WhatsApp users and report totals', async () => {
    prisma.platformUser.findMany.mockResolvedValue([
      { externalId: '1001' },
      { externalId: '1002' },
    ]);
    whatsappService.send.mockResolvedValue(undefined);

    const result = await service.sendBroadcast('Hello there');

    expect(result).toEqual({ totalRecipients: 2, sent: 2, failed: 0 });
    expect(whatsappService.send).toHaveBeenCalledTimes(2);
  });

  it('should report failures without stopping the broadcast', async () => {
    prisma.platformUser.findMany.mockResolvedValue([
      { externalId: '1001' },
      { externalId: '1002' },
    ]);
    whatsappService.send
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined);

    const result = await service.sendBroadcast('Hello there');

    expect(result).toEqual({ totalRecipients: 2, sent: 1, failed: 1 });
  });

  it('should return zero recipients when there are no WhatsApp users', async () => {
    prisma.platformUser.findMany.mockResolvedValue([]);

    const result = await service.sendBroadcast('Hello there');

    expect(result).toEqual({ totalRecipients: 0, sent: 0, failed: 0 });
  });
});
