import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { LegalAgentService } from '../agents/legal.agent';
import { ConversationService } from '../memory/conversation.service';
import { SmsService } from './sms.service';

describe('SmsService', () => {
  let service: SmsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmsService,
        { provide: HttpService, useValue: { axiosRef: { post: jest.fn() } } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: LegalAgentService, useValue: { processQuery: jest.fn() } },
        {
          provide: ConversationService,
          useValue: { getOrCreateSession: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<SmsService>(SmsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
