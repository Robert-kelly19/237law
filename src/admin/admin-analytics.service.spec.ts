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

  function startOfWeek(date: Date): Date {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    const day = normalized.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    normalized.setDate(normalized.getDate() + diff);
    return normalized;
  }

  function formatMonth(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
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

  describe('getWeeklyUsers', () => {
    it('should group by Monday week boundaries and include zero-activity weeks', async () => {
      const currentWeekStart = startOfWeek(new Date());
      const previousWeekStart = new Date(currentWeekStart);
      previousWeekStart.setDate(currentWeekStart.getDate() - 7);
      const twoWeeksAgoStart = new Date(currentWeekStart);
      twoWeeksAgoStart.setDate(currentWeekStart.getDate() - 14);

      mockQueryRaw.mockResolvedValue([
        { week_start: formatDate(previousWeekStart), count: 4n },
      ]);

      const result = await service.getWeeklyUsers(3);

      expect(result.weeks).toHaveLength(3);
      expect(result.weeks[0].weekStart).toBe(formatDate(twoWeeksAgoStart));
      expect(result.weeks[1].weekStart).toBe(formatDate(previousWeekStart));
      expect(result.weeks[2].weekStart).toBe(formatDate(currentWeekStart));
      expect(result.weeks[0].users).toBe(0);
      expect(result.weeks[1].users).toBe(4);
      expect(result.weeks[2].users).toBe(0);
    });

    it('should count distinct WhatsApp users and reject invalid week values', async () => {
      mockQueryRaw.mockResolvedValue([]);
      await service.getWeeklyUsers(1);

      const sql = extractSql(mockQueryRaw);
      expect(sql).toContain('date_trunc');
      expect(sql).toContain('COUNT(DISTINCT ct."userId")');
      expect(sql).toContain('whatsapp');

      await expect(service.getWeeklyUsers(0)).rejects.toThrow(BadRequestException);
      await expect(service.getWeeklyUsers(-1)).rejects.toThrow(BadRequestException);
      await expect(service.getWeeklyUsers(53)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getMonthlyUsers', () => {
    it('should group by calendar month and include zero-activity months', async () => {
      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const previousMonthStart = new Date(currentMonthStart);
      previousMonthStart.setMonth(currentMonthStart.getMonth() - 1);
      const twoMonthsAgoStart = new Date(currentMonthStart);
      twoMonthsAgoStart.setMonth(currentMonthStart.getMonth() - 2);

      mockQueryRaw.mockResolvedValue([
        { month: formatMonth(previousMonthStart), count: 7n },
      ]);

      const result = await service.getMonthlyUsers(3);

      expect(result.months).toHaveLength(3);
      expect(result.months[0].month).toBe(formatMonth(twoMonthsAgoStart));
      expect(result.months[1].month).toBe(formatMonth(previousMonthStart));
      expect(result.months[2].month).toBe(formatMonth(currentMonthStart));
      expect(result.months[0].users).toBe(0);
      expect(result.months[1].users).toBe(7);
      expect(result.months[2].users).toBe(0);
    });

    it('should count distinct WhatsApp users and reject invalid month values', async () => {
      mockQueryRaw.mockResolvedValue([]);
      await service.getMonthlyUsers(1);

      const sql = extractSql(mockQueryRaw);
      expect(sql).toContain('TO_CHAR(ct."createdAt", \'YYYY-MM\')');
      expect(sql).toContain('COUNT(DISTINCT ct."userId")');
      expect(sql).toContain('whatsapp');

      await expect(service.getMonthlyUsers(0)).rejects.toThrow(BadRequestException);
      await expect(service.getMonthlyUsers(-1)).rejects.toThrow(BadRequestException);
      await expect(service.getMonthlyUsers(25)).rejects.toThrow(BadRequestException);
    });
  });
});
