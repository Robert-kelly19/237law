import { UnauthorizedException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import type { Queue } from 'bullmq';
import type { Request } from 'express';
import { ConversationService } from '../memory/conversation.service';
import { LegalAgentService } from '../agents/legal.agent';
import { PlatformUserService } from '../users/platform-user.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';

const APP_SECRET = 'test-app-secret';

describe('WhatsappController webhook', () => {
  const queueAdd = jest.fn().mockResolvedValue(undefined);
  const processQuery = jest.fn().mockResolvedValue({ answer: 'reply' });
  let controller: WhatsappController;

  beforeEach(() => {
    queueAdd.mockClear();
    processQuery.mockClear();
    controller = new WhatsappController(
      {
        send: jest.fn().mockResolvedValue(undefined),
        sendTypingIndicator: jest.fn().mockResolvedValue(undefined),
      } as unknown as WhatsappService,
      { processQuery } as unknown as LegalAgentService,
      {
        getOrCreateSession: jest.fn().mockResolvedValue('session-id'),
      } as unknown as ConversationService,
      {
        upsertWhatsAppUser: jest.fn().mockResolvedValue(undefined),
      } as unknown as PlatformUserService,
      {
        get: jest.fn().mockReturnValue(APP_SECRET),
      } as unknown as ConfigService,
      { add: queueAdd } as unknown as Queue<{ from: string; mediaId: string }>,
    );
  });

  afterEach(() => controller.onModuleDestroy());

  it('rejects webhooks with a missing or invalid signature', async () => {
    const rawBody = Buffer.from('{}');
    const request = {
      rawBody,
      header: jest.fn().mockReturnValue(undefined),
    } as unknown as RawBodyRequest<Request>;

    await expect(controller.receiveMessage({}, request)).rejects.toThrow(
      UnauthorizedException,
    );

    request.header = jest.fn().mockReturnValue(`sha256=${'0'.repeat(64)}`);
    await expect(controller.receiveMessage({}, request)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('queues every audio message and still processes text messages', async () => {
    const rawBody = Buffer.from('signed webhook payload');
    const signature = `sha256=${createHmac('sha256', APP_SECRET)
      .update(rawBody)
      .digest('hex')}`;
    const request = {
      rawBody,
      header: jest.fn().mockReturnValue(signature),
    } as unknown as RawBodyRequest<Request>;
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'audio-1',
                    from: '237600000001',
                    type: 'audio',
                    audio: { id: 'media-1' },
                  },
                  {
                    id: 'text-1',
                    from: '237600000002',
                    type: 'text',
                    text: { body: 'Hello' },
                  },
                  {
                    id: 'audio-2',
                    from: '237600000003',
                    type: 'audio',
                    audio: { id: 'media-2' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    await expect(controller.receiveMessage(body, request)).resolves.toEqual({
      status: 'EVENT_RECEIVED',
    });

    expect(queueAdd).toHaveBeenNthCalledWith(
      1,
      'voice',
      { from: '237600000001', mediaId: 'media-1' },
      { jobId: 'audio-1' },
    );
    expect(queueAdd).toHaveBeenNthCalledWith(
      2,
      'voice',
      { from: '237600000003', mediaId: 'media-2' },
      { jobId: 'audio-2' },
    );
    expect(processQuery).toHaveBeenCalledTimes(1);
    expect(processQuery).toHaveBeenCalledWith({
      userId: '237600000002',
      sessionId: 'session-id',
      query: 'Hello',
    });
  });
});
