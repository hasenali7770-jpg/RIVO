import { Injectable, Logger } from '@nestjs/common';
import type { VerificationStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { StorageService } from '../../integrations/r2/storage.service';
import { StreamService } from '../../integrations/stream/stream.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { AdminContext } from './admin.service';

/**
 * Admin operations outside property moderation: users, payments, incidents,
 * reels, verification, reports, flags and audit search.
 * Master Plan §9 modules 2, 5–13.
 */
@Injectable()
export class AdminOperationsService {
  private readonly logger = new Logger(AdminOperationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly stream: StreamService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
    private readonly flags: FeatureFlagsService,
  ) {}

  // --- Users -----------------------------------------------------------------

  async listUsers(params: { q?: string; sellerType?: string; blocked?: boolean; page?: number; limit?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(params.limit ?? 25, 100);
    const where = {
      deletedAt: null,
      ...(params.sellerType ? { sellerType: params.sellerType as never } : {}),
      ...(params.blocked === true ? { blockedAt: { not: null } } : {}),
      ...(params.blocked === false ? { blockedAt: null } : {}),
      ...(params.q
        ? {
            OR: [
              { phoneE164: { contains: params.q } },
              { displayName: { contains: params.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          sellerProfile: { select: { verification: true, officeName: true } },
          _count: { select: { properties: true, incidents: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map((u) => ({
        id: u.id,
        phone: u.phoneE164,
        displayName: u.displayName,
        sellerType: u.sellerType,
        verification: u.sellerProfile?.verification ?? 'NONE',
        officeName: u.sellerProfile?.officeName ?? null,
        blocked: u.blockedAt !== null,
        blockedReason: u.blockedReason,
        // Whether the user opted into telemetry is shown; their location data
        // never is. Master Plan §13 forbids exposing raw GPS to admins.
        telemetryOptIn: u.telemetryOptIn,
        listingsCount: u._count.properties,
        incidentsCount: u._count.incidents,
        createdAt: u.createdAt,
        lastSeenAt: u.lastSeenAt,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        sellerProfile: true,
        devices: { orderBy: { lastActiveAt: 'desc' }, take: 10 },
        properties: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, reference: true, title: true, status: true, createdAt: true } },
        payments: { orderBy: { createdAt: 'desc' }, take: 20 },
        verifications: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    if (!user) throw AppError.notFound({ message: 'User not found' });

    return {
      id: user.id,
      phone: user.phoneE164,
      phoneVerified: user.phoneVerified,
      displayName: user.displayName,
      sellerType: user.sellerType,
      locale: user.locale,
      blocked: user.blockedAt !== null,
      blockedAt: user.blockedAt,
      blockedReason: user.blockedReason,
      telemetryOptIn: user.telemetryOptIn,
      createdAt: user.createdAt,
      lastSeenAt: user.lastSeenAt,
      sellerProfile: user.sellerProfile,
      devices: user.devices.map((d) => ({
        platform: d.platform,
        model: d.model,
        appVersion: d.appVersion,
        lastActiveAt: d.lastActiveAt,
      })),
      properties: user.properties,
      payments: user.payments.map((p) => ({
        id: p.id,
        amountIqd: p.amountIqd,
        status: p.status,
        provider: p.provider,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
      })),
      verifications: user.verifications.map((v) => ({
        id: v.id,
        status: v.status,
        requestedType: v.requestedType,
        createdAt: v.createdAt,
        reviewedAt: v.reviewedAt,
      })),
    };
  }

  async setUserBlocked(userId: string, blocked: boolean, reason: string | null, ctx: AdminContext) {
    if (blocked && (!reason || reason.trim().length < 5)) {
      throw AppError.badRequest({ code: ErrorCode.VALIDATION_FAILED, message: 'Blocking a user requires a reason' });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        blockedAt: blocked ? new Date() : null,
        blockedReason: blocked ? reason : null,
      },
    });

    if (blocked) {
      // Revoking sessions makes the block take effect immediately rather than
      // when the current access token expires.
      await this.prisma.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'user_blocked' },
      });
    }

    await this.audit.record({
      adminId: ctx.adminId,
      action: blocked ? 'user.block' : 'user.unblock',
      entityType: 'user',
      entityId: userId,
      reason,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { id: userId, blocked };
  }

  // --- Payments --------------------------------------------------------------

  async listPayments(params: { status?: string; propertyId?: string; page?: number; limit?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(params.limit ?? 25, 100);
    const where = {
      ...(params.status ? { status: params.status as never } : {}),
      ...(params.propertyId ? { propertyId: params.propertyId } : {}),
    };

    const [items, total, totals] = await Promise.all([
      this.prisma.listingPayment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          property: { select: { reference: true, title: true, status: true } },
          user: { select: { id: true, phoneE164: true, displayName: true } },
        },
      }),
      this.prisma.listingPayment.count({ where }),
      this.prisma.listingPayment.aggregate({ where: { status: 'PAID' }, _sum: { amountIqd: true }, _count: true }),
    ]);

    return {
      items: items.map((p) => ({
        id: p.id,
        amountIqd: p.amountIqd,
        currency: p.currency,
        status: p.status,
        provider: p.provider,
        merchantRef: p.merchantRef,
        providerRef: p.providerRef,
        failureReason: p.failureReason,
        settledByAdminId: p.settledByAdminId,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
        property: p.property,
        user: p.user,
      })),
      summary: { paidCount: totals._count, totalRevenueIqd: totals._sum.amountIqd ?? 0 },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Webhook forensics: every event received, including rejected ones. */
  async listPaymentEvents(paymentId: string) {
    const events = await this.prisma.paymentEvent.findMany({
      where: { paymentId },
      orderBy: { createdAt: 'desc' },
    });
    return events.map((e) => ({
      id: e.id,
      provider: e.provider,
      eventType: e.eventType,
      providerEventId: e.providerEventId,
      signatureValid: e.signatureValid,
      rejectionReason: e.rejectionReason,
      sourceIp: e.sourceIp,
      processedAt: e.processedAt,
      createdAt: e.createdAt,
      payload: e.payload,
    }));
  }

  /**
   * Settles a payment received offline.
   *
   * This is the only non-webhook path to PAID, and it is deliberately narrow:
   * FINANCE or SUPER_ADMIN only, a mandatory reference for the money actually
   * received, and an audit-log entry naming the operator. It exists because the
   * business genuinely takes cash and bank transfers today, not to simulate a
   * gateway.
   */
  async settlePaymentManually(paymentId: string, ctx: AdminContext, params: { reference: string; note: string }) {
    if (!params.reference || params.reference.trim().length < 3) {
      throw AppError.badRequest({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'A settlement reference is required — record the transfer or receipt number',
      });
    }
    if (!params.note || params.note.trim().length < 10) {
      throw AppError.badRequest({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Explain how the payment was received (at least 10 characters)',
      });
    }

    const payment = await this.prisma.listingPayment.findUnique({
      where: { id: paymentId },
      include: { property: { select: { id: true, status: true, reference: true } } },
    });
    if (!payment) throw AppError.notFound({ message: 'Payment not found' });

    if (payment.status === 'PAID') {
      throw new AppError(409, {
        code: ErrorCode.PAYMENT_ALREADY_PAID,
        message: 'This payment is already settled',
      });
    }

    await this.payments.markPaid(
      paymentId,
      `manual:${params.reference.trim()}`,
      payment.propertyId,
      payment.property.status,
      ctx.adminId,
    );

    await this.audit.record({
      adminId: ctx.adminId,
      action: 'payment.settle_manual',
      entityType: 'payment',
      entityId: paymentId,
      changes: {
        from: payment.status,
        to: 'PAID',
        amountIqd: payment.amountIqd,
        settlementReference: params.reference,
        propertyReference: payment.property.reference,
      },
      reason: params.note,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { id: paymentId, status: 'PAID', settledBy: ctx.adminId };
  }

  // --- Road incidents --------------------------------------------------------

  async listIncidents(params: { status?: string; type?: string; page?: number; limit?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(params.limit ?? 25, 100);
    const where = {
      ...(params.status ? { status: params.status as never } : {}),
      ...(params.type ? { type: params.type as never } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.roadIncident.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { reportedBy: { select: { id: true, phoneE164: true, displayName: true } } },
      }),
      this.prisma.roadIncident.count({ where }),
    ]);

    return {
      items: items.map((i) => ({
        id: i.id,
        type: i.type,
        status: i.status,
        lat: i.lat,
        lng: i.lng,
        note: i.note,
        score: i.score,
        confirmCount: i.confirmCount,
        dismissCount: i.dismissCount,
        confidence: i.confidence,
        expiresAt: i.expiresAt,
        createdAt: i.createdAt,
        reportedBy: i.reportedBy,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async removeIncident(incidentId: string, ctx: AdminContext, reason: string) {
    const incident = await this.prisma.roadIncident.findUnique({ where: { id: incidentId } });
    if (!incident) throw AppError.notFound({ message: 'Incident not found' });

    await this.prisma.roadIncident.update({
      where: { id: incidentId },
      data: { status: 'REMOVED', removedByAdminId: ctx.adminId, removedReason: reason },
    });

    await this.audit.record({
      adminId: ctx.adminId,
      action: 'incident.remove',
      entityType: 'incident',
      entityId: incidentId,
      changes: { type: incident.type, from: incident.status },
      reason,
      ip: ctx.ip,
    });

    return { id: incidentId, status: 'REMOVED' };
  }

  async approveIncident(incidentId: string, ctx: AdminContext) {
    await this.prisma.roadIncident.update({ where: { id: incidentId }, data: { status: 'ACTIVE' } });
    await this.audit.record({
      adminId: ctx.adminId,
      action: 'incident.approve',
      entityType: 'incident',
      entityId: incidentId,
      ip: ctx.ip,
    });
    return { id: incidentId, status: 'ACTIVE' };
  }

  // --- Reels -----------------------------------------------------------------

  async listReels(params: { status?: string; page?: number; limit?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(params.limit ?? 25, 100);
    const where = params.status ? { status: params.status as never } : {};

    const [items, total] = await Promise.all([
      this.prisma.propertyVideo.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          property: {
            select: { id: true, reference: true, title: true, status: true, owner: { select: { id: true, phoneE164: true } } },
          },
        },
      }),
      this.prisma.propertyVideo.count({ where }),
    ]);

    return {
      items: items.map((v) => ({
        id: v.id,
        status: v.status,
        hlsUrl: v.playbackHlsUrl,
        thumbnailUrl: v.thumbnailUrl,
        width: v.width,
        height: v.height,
        shortEdge: v.shortEdge,
        durationSeconds: v.durationSeconds,
        caption: v.caption,
        validationError: v.validationError,
        viewCount: v.viewCount,
        createdAt: v.createdAt,
        property: v.property,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Takes a reel down — used for non-property content, which §7 forbids. */
  async removeReel(videoId: string, ctx: AdminContext, reason: string) {
    const video = await this.prisma.propertyVideo.findUnique({
      where: { id: videoId },
      include: { property: { select: { id: true, ownerId: true, reference: true } } },
    });
    if (!video) throw AppError.notFound({ message: 'Reel not found' });

    await this.prisma.propertyVideo.update({
      where: { id: videoId },
      data: { status: 'REJECTED', validationError: reason },
    });

    if (video.streamUid) {
      this.stream
        .deleteVideo(video.streamUid)
        .catch((err) => this.logger.warn(`Could not delete Stream video ${video.streamUid}: ${err.message}`));
    }

    await this.audit.record({
      adminId: ctx.adminId,
      action: 'reel.remove',
      entityType: 'reel',
      entityId: videoId,
      changes: { propertyReference: video.property.reference },
      reason,
      ip: ctx.ip,
    });

    await this.notifications.notify(video.property.ownerId, {
      type: 'REEL_REMOVED',
      titleAr: 'تمت إزالة الريل',
      titleEn: 'Your reel was removed',
      bodyAr: `تمت إزالة ريل إعلان ${video.property.reference}: ${reason}`,
      bodyEn: `The reel for listing ${video.property.reference} was removed: ${reason}`,
      deepLink: `rivo://property/${video.property.id}`,
    });

    return { id: videoId, status: 'REJECTED' };
  }

  // --- Seller verification ---------------------------------------------------

  async listVerifications(params: { status?: string; page?: number; limit?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(params.limit ?? 25, 100);
    const where = params.status ? { status: params.status as VerificationStatus } : {};

    const [items, total] = await Promise.all([
      this.prisma.sellerVerification.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { id: true, phoneE164: true, displayName: true, sellerType: true } } },
      }),
      this.prisma.sellerVerification.count({ where }),
    ]);

    return {
      items: await Promise.all(
        items.map(async (v) => ({
          id: v.id,
          status: v.status,
          requestedType: v.requestedType,
          note: v.note,
          createdAt: v.createdAt,
          reviewedAt: v.reviewedAt,
          rejectionReason: v.rejectionReason,
          user: v.user,
          // Documents are private objects; a short-lived signed URL is minted
          // per view rather than the key being made public.
          documents: await Promise.all(
            v.documentKeys.map(async (key) => ({
              key,
              url: await this.storage.presignDownload(key, 15).catch(() => null),
            })),
          ),
        })),
      ),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async decideVerification(
    verificationId: string,
    ctx: AdminContext,
    decision: 'VERIFIED' | 'REJECTED',
    reason?: string,
  ) {
    if (decision === 'REJECTED' && (!reason || reason.trim().length < 10)) {
      throw AppError.badRequest({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'A rejection requires a reason of at least 10 characters',
      });
    }

    const verification = await this.prisma.sellerVerification.findUnique({
      where: { id: verificationId },
      include: { user: { select: { id: true } } },
    });
    if (!verification) throw AppError.notFound({ message: 'Verification request not found' });

    await this.prisma.$transaction([
      this.prisma.sellerVerification.update({
        where: { id: verificationId },
        data: {
          status: decision,
          reviewedByAdminId: ctx.adminId,
          reviewedAt: new Date(),
          rejectionReason: decision === 'REJECTED' ? reason : null,
        },
      }),
      this.prisma.sellerProfile.update({
        where: { userId: verification.userId },
        data: {
          verification: decision,
          verifiedAt: decision === 'VERIFIED' ? new Date() : null,
          ...(decision === 'VERIFIED' ? { sellerType: verification.requestedType } : {}),
        },
      }),
      ...(decision === 'VERIFIED'
        ? [
            this.prisma.user.update({
              where: { id: verification.userId },
              data: { sellerType: verification.requestedType },
            }),
            // Existing listings inherit the badge so a newly verified office
            // does not have to resubmit its stock.
            this.prisma.property.updateMany({
              where: { ownerId: verification.userId },
              data: { isVerifiedListing: true, sellerType: verification.requestedType },
            }),
          ]
        : [
            this.prisma.property.updateMany({
              where: { ownerId: verification.userId },
              data: { isVerifiedListing: false },
            }),
          ]),
    ]);

    await this.audit.record({
      adminId: ctx.adminId,
      action: decision === 'VERIFIED' ? 'verification.approve' : 'verification.reject',
      entityType: 'verification',
      entityId: verificationId,
      changes: { userId: verification.userId, requestedType: verification.requestedType },
      reason,
      ip: ctx.ip,
    });

    await this.notifications.notify(verification.userId, {
      type: 'VERIFICATION_RESULT',
      titleAr: decision === 'VERIFIED' ? 'تم توثيق حسابك' : 'لم يتم قبول طلب التوثيق',
      titleEn: decision === 'VERIFIED' ? 'Your account is verified' : 'Verification was not approved',
      bodyAr:
        decision === 'VERIFIED'
          ? 'تم توثيق حسابك وستظهر علامة التوثيق على إعلاناتك.'
          : `سبب الرفض: ${reason}`,
      bodyEn:
        decision === 'VERIFIED'
          ? 'Your account is verified and the badge now appears on your listings.'
          : `Reason: ${reason}`,
    });

    return { id: verificationId, status: decision };
  }

  // --- Reports ---------------------------------------------------------------

  async listReports(params: { status?: string; page?: number; limit?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(params.limit ?? 25, 100);
    const where = params.status ? { status: params.status as never } : {};

    const [items, total] = await Promise.all([
      this.prisma.propertyReport.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          property: { select: { id: true, reference: true, title: true, status: true } },
          reporter: { select: { id: true, phoneE164: true } },
        },
      }),
      this.prisma.propertyReport.count({ where }),
    ]);

    return {
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async resolveReport(reportId: string, ctx: AdminContext, status: 'ACTIONED' | 'DISMISSED', note: string) {
    const report = await this.prisma.propertyReport.findUnique({ where: { id: reportId } });
    if (!report) throw AppError.notFound({ message: 'Report not found' });

    await this.prisma.propertyReport.update({
      where: { id: reportId },
      data: { status, resolvedByAdminId: ctx.adminId, resolvedAt: new Date(), resolutionNote: note },
    });

    await this.audit.record({
      adminId: ctx.adminId,
      action: `report.${status.toLowerCase()}`,
      entityType: 'report',
      entityId: reportId,
      changes: { propertyId: report.propertyId, reason: report.reason },
      reason: note,
      ip: ctx.ip,
    });

    return { id: reportId, status };
  }

  // --- Media / AI jobs -------------------------------------------------------

  async listJobs(params: { status?: string; type?: string; page?: number; limit?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(params.limit ?? 25, 100);
    const where = {
      ...(params.status ? { status: params.status as never } : {}),
      ...(params.type ? { type: params.type } : {}),
    };

    const [aiJobs, mediaJobs, aiTotal, mediaTotal] = await Promise.all([
      this.prisma.aiJob.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: (page - 1) * limit }),
      this.prisma.mediaJob.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: (page - 1) * limit }),
      this.prisma.aiJob.count({ where }),
      this.prisma.mediaJob.count({ where }),
    ]);

    return {
      aiJobs: aiJobs.map((j) => ({
        id: j.id,
        type: j.type,
        status: j.status,
        provider: j.provider,
        model: j.model,
        operations: j.operations,
        costUsd: j.costUsd,
        attempts: j.attempts,
        error: j.error,
        createdAt: j.createdAt,
        finishedAt: j.finishedAt,
      })),
      mediaJobs: mediaJobs.map((j) => ({
        id: j.id,
        type: j.type,
        status: j.status,
        attempts: j.attempts,
        error: j.error,
        createdAt: j.createdAt,
        finishedAt: j.finishedAt,
      })),
      pagination: { page, limit, total: aiTotal + mediaTotal },
    };
  }

  // --- Feature flags ---------------------------------------------------------

  async listFlags() {
    return this.flags.listForAdmin();
  }

  async setFlag(key: string, enabled: boolean, ctx: AdminContext) {
    const before = await this.prisma.featureFlag.findUnique({ where: { key } });
    await this.flags.set(key, enabled, ctx.adminId);

    await this.audit.record({
      adminId: ctx.adminId,
      action: 'flag.update',
      entityType: 'flag',
      entityId: key,
      changes: { from: before?.enabled ?? null, to: enabled },
      ip: ctx.ip,
    });

    return { key, enabled };
  }

  // --- Audit log -------------------------------------------------------------

  async listAuditLogs(params: {
    entityType?: string;
    entityId?: string;
    adminId?: string;
    action?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(params.limit ?? 50, 200);
    const { items, total } = await this.audit.list({
      entityType: params.entityType,
      entityId: params.entityId,
      adminId: params.adminId,
      action: params.action,
      from: params.from ? new Date(params.from) : undefined,
      to: params.to ? new Date(params.to) : undefined,
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }
}
