import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { toFile } from 'openai';
import ffmpeg from 'fluent-ffmpeg';
import { PassThrough } from 'node:stream';

const MAX_SPOKEN_CHARACTERS = 600;

@Injectable()
export class SpeechService {
  private readonly logger = new Logger(SpeechService.name);
  private readonly openai: OpenAI;

  constructor(configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey: configService.get<string>('OPENAI_API_KEY'),
    });
  }

  async transcribe(audio: Buffer): Promise<string> {
    try {
      const file = await toFile(audio, 'voice.ogg', { type: 'audio/ogg' });
      const result = await this.openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
      });

      return result.text;
    } catch (error) {
      this.logFailure('transcribe incoming audio', error);
      throw error;
    }
  }

  async synthesize(text: string): Promise<Buffer> {
    try {
      const audio = await this.openai.audio.speech.create({
        model: 'tts-1',
        voice: 'alloy',
        input: this.limitSpokenText(text),
        response_format: 'opus',
      });

      return this.toOggOpus(Buffer.from(await audio.arrayBuffer()));
    } catch (error) {
      this.logFailure('synthesize reply audio', error);
      throw error;
    }
  }

  async toOggOpus(input: Buffer): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const source = new PassThrough();
      const output = new PassThrough();
      const chunks: Buffer[] = [];
      let settled = false;

      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        output.destroy();
        reject(error);
      };

      output.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      output.once('error', fail);
      output.once('end', () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks));
      });

      ffmpeg(source)
        .noVideo()
        .audioCodec('libopus')
        .format('ogg')
        .on('error', fail)
        .pipe(output, { end: true });

      source.end(input);
    });
  }

  private limitSpokenText(text: string): string {
    const normalized = text.trim();
    if (normalized.length <= MAX_SPOKEN_CHARACTERS) return normalized;

    const truncated = normalized
      .slice(0, MAX_SPOKEN_CHARACTERS - 3)
      .replace(/\s+\S*$/, '')
      .trimEnd();
    return `${truncated || normalized.slice(0, MAX_SPOKEN_CHARACTERS - 3)}...`;
  }

  private logFailure(action: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`Failed to ${action}: ${message}`);
  }
}
