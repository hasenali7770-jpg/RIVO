import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface NotifyParams {
  type: string;
  titleAr: string;
  titleEn?: string;
  bodyAr: string;
  bodyEn?: string;
  deepLink?: string;
  data?: Record<string, unknown>;
}

/**
 * In-app notifications.
 *
 * Push delivery (FCM/APNs) is not wired in the MVP: it needs the client's own
 * Firebase project and APNs key, which are part of the account checklist in
 * docs/purchase-checklist. The `push_sent_at` and `push_error` columns and the
 * stored device push tokens are already in place, so enabling push later is a
 * worker change, not a schema change.
 *
 * Nothing here pretends a push was delivered.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async notify(userId: string, params: NotifyParams): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: {
          userId,
          type: params.type,
          titleAr: params.titleAr,
          titleEn: params.titleEn,
          bodyAr: params.bodyAr,
          bodyEn: params.bodyEn,
          deepLink: params.deepLink,
          data: (params.data as object) ?? undefined,
        },
      });
    } catch (err) {
      // A notification failure must never roll back the action that triggered it.
      this.logger.error(
        `Could not create ${params.type} notification for user ${userId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async list(userId: string, params: { unreadOnly?: boolean; page?: number; limit?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(params.limit ?? 20, 50);
    const where = { userId, ...(params.unreadOnly ? { readAt: null } : {}) };

    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    return {
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: { ar: n.titleAr, en: n.titleEn },
        body: { ar: n.bodyAr, en: n.bodyEn },
        deepLink: n.deepLink,
        data: n.data,
        read: n.readAt !== null,
        createdAt: n.createdAt,
      })),
      unreadCount: unread,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async markRead(userId: string, notificationId: string) {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { read: true };
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { markedRead: result.count };
  }
}
