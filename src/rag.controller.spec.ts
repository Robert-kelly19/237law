import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminAuthGuard } from './admin/admin-auth.guard';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';
import { LegalAgentService } from './agents/legal.agent';

describe('RagController PDF ingestion', () => {
  it('reports an unsuccessful operation when any PDF source fails', async () => {
    const ragService = {
      ingestPdfs: jest.fn().mockResolvedValue({
        ingested: ['complete.pdf'],
        skipped: [],
        failed: ['partial.pdf'],
      }),
    };
    const controller = new RagController(
      ragService as unknown as RagService,
      {} as LegalAgentService,
    );

    await expect(controller.reingestAll()).resolves.toEqual({
      success: false,
      ingested: ['complete.pdf'],
      skipped: [],
      failed: ['partial.pdf'],
    });
  });

  it('reports success only when all sources were verified or skipped', async () => {
    const ragService = {
      ingestPdfs: jest.fn().mockResolvedValue({
        ingested: ['complete.pdf'],
        skipped: ['unchanged.pdf'],
        failed: [],
      }),
    };
    const controller = new RagController(
      ragService as unknown as RagService,
      {} as LegalAgentService,
    );

    await expect(controller.reingestAll()).resolves.toEqual({
      success: true,
      ingested: ['complete.pdf'],
      skipped: ['unchanged.pdf'],
      failed: [],
    });
  });

  it('protects the manual re-ingestion route with admin authentication', () => {
    const method = Object.getOwnPropertyDescriptor(
      RagController.prototype,
      'reingestAll',
    );
    expect(method).toBeDefined();
    if (!method) {
      throw new Error('reingestAll method descriptor is missing');
    }

    expect(
      Reflect.getMetadata(GUARDS_METADATA, method.value as object),
    ).toEqual([AdminAuthGuard]);
  });
});
