import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

export interface AnalyticsOverview {
  totalUsers: number;
  todayUsers: number;
  thisWeekUsers: number;
  thisMonthUsers: number;
}

export interface DailyUserEntry {
  date: string;
  users: number;
}

export interface DailyUsersResponse {
  days: DailyUserEntry[];
}

export interface WeeklyUserEntry {
  weekStart: string;
  users: number;
}

export interface WeeklyUsersResponse {
  weeks: WeeklyUserEntry[];
}

export interface MonthlyUserEntry {
  month: string;
  users: number;
}

export interface MonthlyUsersResponse {
  months: MonthlyUserEntry[];
}

@Injectable()
export class AdminAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(): Promise<AnalyticsOverview> {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const [totalUsers, todayUsers, thisWeekUsers, thisMonthUsers] =
      await Promise.all([
        this.prisma.platformUser.count({
          where: { channel: 'whatsapp' },
        }),
        this.countActiveUsersSince(startOfToday),
        this.countActiveUsersSince(
          new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        ),
        this.countActiveUsersSince(
          new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        ),
      ]);

    return {
      totalUsers,
      todayUsers,
      thisWeekUsers,
      thisMonthUsers,
    };
  }

  async getDailyUsers(days: number = 30): Promise<DailyUsersResponse> {
    this.validateRange(days, 1, 365, 'days');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startDate = new Date(today);
    startDate.setDate(today.getDate() - (days - 1));

    const expectedDates: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - (days - 1 - i));
      expectedDates.push(this.formatDate(d));
    }

    const results = await this.prisma.$queryRaw<
      Array<{ date: string; count: bigint }>
    >(Prisma.sql`
      SELECT
        TO_CHAR(ct."createdAt", 'YYYY-MM-DD') AS "date",
        COUNT(DISTINCT ct."userId")::bigint AS "count"
      FROM "conversation_turns" AS ct
      INNER JOIN "platform_users" AS pu
        ON pu."externalId" = ct."userId"
      AND pu."channel" = 'whatsapp'
      WHERE ct."createdAt" >= ${startDate}
      AND ct."createdAt" < ${new Date(today.getTime() + 86400000)}
      GROUP BY TO_CHAR(ct."createdAt", 'YYYY-MM-DD')
      ORDER BY "date"
    `);

    const countMap = new Map(
      results.map((r) => [r.date, Number(r.count)]),
    );

    return {
      days: expectedDates.map((date) => ({
        date,
        users: countMap.get(date) ?? 0,
      })),
    };
  }

  async getWeeklyUsers(weeks: number = 12): Promise<WeeklyUsersResponse> {
    this.validateRange(weeks, 1, 52, 'weeks');

    const today = new Date();
    const endExclusive = new Date(today);
    endExclusive.setDate(endExclusive.getDate() + 1);
    endExclusive.setHours(0, 0, 0, 0);

    const startOfCurrentWeek = this.getStartOfWeek(today);
    const startDate = new Date(startOfCurrentWeek);
    startDate.setDate(startOfCurrentWeek.getDate() - (weeks - 1) * 7);

    const expectedWeeks: string[] = [];
    for (let i = 0; i < weeks; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i * 7);
      expectedWeeks.push(this.formatDate(d));
    }

    const results = await this.prisma.$queryRaw<
      Array<{ week_start: string; count: bigint }>
    >(Prisma.sql`
      SELECT
        TO_CHAR(date_trunc('week', ct."createdAt"), 'YYYY-MM-DD') AS "week_start",
        COUNT(DISTINCT ct."userId")::bigint AS "count"
      FROM "conversation_turns" AS ct
      INNER JOIN "platform_users" AS pu
        ON pu."externalId" = ct."userId"
       AND pu."channel" = 'whatsapp'
      WHERE ct."createdAt" >= ${startDate}
        AND ct."createdAt" < ${endExclusive}
      GROUP BY TO_CHAR(date_trunc('week', ct."createdAt"), 'YYYY-MM-DD')
      ORDER BY "week_start"
    `);

    const countMap = new Map(
      results.map((r) => [r.week_start, Number(r.count)]),
    );

    return {
      weeks: expectedWeeks.map((weekStart) => ({
        weekStart,
        users: countMap.get(weekStart) ?? 0,
      })),
    };
  }

  async getMonthlyUsers(months: number = 12): Promise<MonthlyUsersResponse> {
    this.validateRange(months, 1, 24, 'months');

    const today = new Date();
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const startDate = new Date(currentMonthStart);
    startDate.setMonth(startDate.getMonth() - (months - 1));

    const expectedMonths: string[] = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(currentMonthStart);
      d.setMonth(currentMonthStart.getMonth() - (months - 1 - i));
      expectedMonths.push(this.formatMonth(d));
    }

    const results = await this.prisma.$queryRaw<
      Array<{ month: string; count: bigint }>
    >(Prisma.sql`
      SELECT
        TO_CHAR(ct."createdAt", 'YYYY-MM') AS "month",
        COUNT(DISTINCT ct."userId")::bigint AS "count"
      FROM "conversation_turns" AS ct
      INNER JOIN "platform_users" AS pu
        ON pu."externalId" = ct."userId"
       AND pu."channel" = 'whatsapp'
      WHERE ct."createdAt" >= ${startDate}
        AND ct."createdAt" < ${new Date(today.getFullYear(), today.getMonth() + 1, 1)}
      GROUP BY TO_CHAR(ct."createdAt", 'YYYY-MM')
      ORDER BY "month"
    `);

    const countMap = new Map(
      results.map((r) => [r.month, Number(r.count)]),
    );

    return {
      months: expectedMonths.map((month) => ({
        month,
        users: countMap.get(month) ?? 0,
      })),
    };
  }

  private validateRange(value: number, min: number, max: number, name: string): void {
    if (!Number.isInteger(value) || value < min) {
      throw new BadRequestException(`${name} must be a positive integer`);
    }
    if (value > max) {
      throw new BadRequestException(`${name} must not exceed ${max}`);
    }
  }

  private getStartOfWeek(date: Date): Date {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    const day = normalized.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    normalized.setDate(normalized.getDate() + diff);
    return normalized;
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatMonth(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  private async countActiveUsersSince(since: Date): Promise<number> {
    const result = await this.prisma.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT COUNT(DISTINCT ct."userId")::bigint AS "count"
        FROM "conversation_turns" AS ct
        INNER JOIN "platform_users" AS pu
          ON pu."externalId" = ct."userId"
         AND pu."channel" = 'whatsapp'
        WHERE ct."createdAt" >= ${since}
      `,
    );

    return Number(result[0]?.count ?? 0);
  }
}
