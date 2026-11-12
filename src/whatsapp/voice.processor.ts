import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ConversationService } from '../memory/conversation.service';
import { LegalAgentService } from '../agents/legal.agent';
import { SpeechService } from './speech.service';
import { VoiceRateLimiter } from './voice-rate-limiter.service';
import { WhatsappService } from './whatsapp.service';

interface VoiceJobData {
  from: string;
  mediaId: string;
  sendStatus?: 'sending' | 'sent';
}

@Processor('voice')
export class VoiceProcessor extends WorkerHost {
  private readonly logger = new Logger(VoiceProcessor.name);

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly speechService: SpeechService,
    private readonly legalAgent: LegalAgentService,
    private readonly conversationService: ConversationService,
    private readonly rateLimiter: VoiceRateLimiter,
  ) {
    super();
  }

  async process(job: Job<VoiceJobData>): Promise<void> {
    const { from, mediaId } = job.data;

    try {
      // Avoid duplicate delivery if a previous send may have reached Meta.
      if (job.data.sendStatus) {
        if (job.data.sendStatus === 'sent') return;
        throw new Error(
          'Previous voice-note send outcome is unknown; avoiding duplicate delivery',
        );
      }

      // Limit paid voice requests per sender, while allowing retries of this job.
      if (!job.id) throw new Error('Voice job is missing its job ID');
      const allowed = await this.rateLimiter.tryAcquire(from, job.id);
      if (!allowed) {
        await this.whatsappService.send(
          from,
          'You have sent several voice notes recently. Please try again later.',
        );
        return;
      }

      // Download the temporary media URL with the WhatsApp authorization token.
      const audio = await this.whatsappService.downloadMedia(mediaId);

      // Turn the voice note into text so it follows the existing chat path.
      const text = await this.speechService.transcribe(audio);
      if (!text.trim()) {
        await this.whatsappService.send(
          from,
          "Sorry, I couldn't hear that clearly. Please try sending your voice note again.",
        );
        return;
      }

      // Reuse the same conversation session and legal agent as typed messages.
      const sessionId = await this.conversationService.getOrCreateSession(from);
      const reply = await this.legalAgent.processQuery({
        userId: from,
        sessionId,
        query: text,
      });

      // Synthesize a short spoken version of the chatbot reply.
      const replyAudio = await this.speechService.synthesize(reply.answer);

      // Upload OGG Opus audio so WhatsApp can render it as a voice note.
      const uploadedMediaId =
        await this.whatsappService.uploadAudio(replyAudio);

      // Persist the attempt before sending so retries cannot duplicate a possibly accepted note.
      await job.updateData({ ...job.data, sendStatus: 'sending' });

      // Send the uploaded voice note back to the original sender.
      await this.whatsappService.sendAudio(from, uploadedMediaId);
      try {
        await job.updateData({ ...job.data, sendStatus: 'sent' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Voice note was sent, but its job outcome could not be recorded: ${message}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Voice job ${job.id ?? 'unknown'} failed: ${message}`);

      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= maxAttempts) {
        try {
          await this.whatsappService.send(
            from,
            'Something went wrong while processing your voice note. Please try again shortly.',
          );
        } catch (sendError) {
          const sendMessage =
            sendError instanceof Error ? sendError.message : String(sendError);
          this.logger.error(`Could not send voice error reply: ${sendMessage}`);
        }
      }

      throw error;
    }
  }
}
