import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

export interface AnalyticsOverview {
  totalUsers: number;
  todayUsers: number;
  thisWeekUsers: number;
  thisMonthUsers: number;
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