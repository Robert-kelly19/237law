import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AdminAnalyticsService } from './admin-analytics.service';

describe('AdminAnalyticsService - Daily Users', () => {
  let service: AdminAnalyticsService;
  const mockQueryRaw = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAnalyticsService,
        { provide: PrismaService, useValue: { $queryRaw: mockQueryRaw } },
      ],
    }).compile();

    service = module.get<AdminAnalyticsService>(AdminAnalyticsService);
    mockQueryRaw.mockReset();
  });

  function formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function todayStr(): string {
    return formatDate(new Date());
  }

  function daysAgoStr(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return formatDate(d);
  }

  function extractSql(mock: jest.Mock): string {
    const sqlArg = mock.mock.calls[0]?.[0];
    if (sqlArg && typeof (sqlArg as any).sql === 'string') {
      return (sqlArg as any).sql;
    }
    return JSON.stringify(sqlArg);
  }

  describe('getDailyUsers', () => {
    it('should return correct unique-user count per day', async () => {
      const d2 = daysAgoStr(2);
      const d1 = daysAgoStr(1);
      const td = todayStr();

      mockQueryRaw.mockResolvedValue([
        { date: d2, count: 2n },
        { date: d1, count: 3n },
        { date: td, count: 1n },
      ]);

      const result = await service.getDailyUsers(3);

      expect(result.days).toHaveLength(3);
      expect(result.days[0]).toEqual({ date: d2, users: 2 });
      expect(result.days[1]).toEqual({ date: d1, users: 3 });
      expect(result.days[2]).toEqual({ date: td, users: 1 });
    });

    it('should send a SQL query that filters by WhatsApp channel', async () => {
      mockQueryRaw.mockResolvedValue([]);

      await service.getDailyUsers(1);

      expect(mockQueryRaw).toHaveBeenCalledTimes(1);
      const sql = extractSql(mockQueryRaw);
      expect(sql).toContain('whatsapp');
      expect(sql).toContain('platform_users');
      expect(sql).toContain('INNER JOIN');
    });

    it('should use COUNT(DISTINCT userId) for unique counting', async () => {
      mockQueryRaw.mockResolvedValue([]);

      await service.getDailyUsers(1);

      const sql = extractSql(mockQueryRaw);
      expect(sql).toMatch(/COUNT\s*\(\s*DISTINCT\s+ct\."userId"\s*\)/i);
    });

    it('should count multiple messages from same user on one day as one', async () => {
      // COUNT(DISTINCT userId) ensures one row per unique user
      mockQueryRaw.mockResolvedValue([
        { date: todayStr(), count: 1n },
      ]);

      const result = await service.getDailyUsers(1);

      expect(result.days[0].users).toBe(1);
    });

    it('should return days with zero activity', async () => {
      const yesterday = daysAgoStr(1);

      mockQueryRaw.mockResolvedValue([
        { date: yesterday, count: 3n },
      ]);

      const result = await service.getDailyUsers(3);

      expect(result.days).toHaveLength(3);

      const twoDaysAgoEntry = result.days.find(
        (d) => d.date === daysAgoStr(2),
      );
      expect(twoDaysAgoEntry).toBeDefined();
      expect(twoDaysAgoEntry!.users).toBe(0);

      const yesterdayEntry = result.days.find((d) => d.date === yesterday);
      expect(yesterdayEntry).toBeDefined();
      expect(yesterdayEntry!.users).toBe(3);

      const todayEntry = result.days.find((d) => d.date === todayStr());
      expect(todayEntry).toBeDefined();
      expect(todayEntry!.users).toBe(0);
    });

    it('should default to 30 days when no parameter is given', async () => {
      mockQueryRaw.mockResolvedValue([]);

      const result = await service.getDailyUsers();

      expect(result.days).toHaveLength(30);
    });

    it('should use days parameter when provided', async () => {
      mockQueryRaw.mockResolvedValue([]);

      const result = await service.getDailyUsers(7);

      expect(result.days).toHaveLength(7);
    });

    it('should reject zero days', async () => {
      await expect(service.getDailyUsers(0)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject negative days', async () => {
      await expect(service.getDailyUsers(-1)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject non-integer values', async () => {
      await expect(service.getDailyUsers(2.5)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject unreasonably large values', async () => {
      await expect(service.getDailyUsers(366)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should return dates in chronological order (oldest first)', async () => {
      mockQueryRaw.mockResolvedValue([]);

      const result = await service.getDailyUsers(5);

      const dates = result.days.map((d) => d.date);
      const sorted = [...dates].sort();
      expect(dates).toEqual(sorted);
    });

    it('should include today as the last date in the range', async () => {
      mockQueryRaw.mockResolvedValue([]);

      const result = await service.getDailyUsers(3);

      expect(result.days[result.days.length - 1].date).toBe(todayStr());
    });
  });
});
