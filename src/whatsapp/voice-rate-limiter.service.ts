import { createHash } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_MESSAGES_PER_WINDOW = 5;

const ACQUIRE_SLOT_SCRIPT = `
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
  if redis.call('ZSCORE', KEYS[1], ARGV[2]) then
    return 1
  end
  if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then
    return 0
  end
  redis.call('ZADD', KEYS[1], ARGV[4], ARGV[2])
  redis.call('PEXPIRE', KEYS[1], ARGV[5])
  return 1
`;

@Injectable()
export class VoiceRateLimiter {
  private commandDefined = false;

  constructor(@InjectQueue('voice') private readonly voiceQueue: Queue) {}

  async tryAcquire(phoneNumber: string, messageId: string): Promise<boolean> {
    const phoneHash = createHash('sha256').update(phoneNumber).digest('hex');
    const key = `voice-rate:${phoneHash}`;
    const now = Date.now();
    const client = await this.voiceQueue.client;
    if (!this.commandDefined) {
      client.defineCommand('voiceRateLimit', {
        numberOfKeys: 1,
        lua: ACQUIRE_SLOT_SCRIPT,
      });
      this.commandDefined = true;
    }

    const result: unknown = await client.runCommand('voiceRateLimit', [
      key,
      String(now - RATE_LIMIT_WINDOW_MS),
      messageId,
      String(MAX_MESSAGES_PER_WINDOW),
      String(now),
      String(RATE_LIMIT_WINDOW_MS),
    ]);

    return result === 1 || result === '1';
  }
}
