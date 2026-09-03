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
    if (!Number.isInteger(days) || days < 1) {
      throw new BadRequestException('days must be a positive integer');
    }
    if (days > 365) {
      throw new BadRequestException('days must not exceed 365');
    }

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

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
