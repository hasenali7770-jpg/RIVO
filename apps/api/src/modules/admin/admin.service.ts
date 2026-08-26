import { Injectable } from '@nestjs/common';
import { LISTING_FEE_IQD } from '@rivo/config';
import type { PropertyStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { StorageService } from '../../integrations/r2/storage.service';
import { QueueService } from '../../common/queue/queue.service';
import { PropertiesService } from '../properties/properties.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppError, ErrorCode } from '../../common/errors/app-error';

export interface AdminContext {
  adminId: string;
  ip: string | null;
  userAgent: string | null;
  requestId?: string;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly properties: PropertiesService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Dashboard KPIs
  // ---------------------------------------------------------------------------

  async dashboard() {
    const dayAgo = new Date(Date.now() - 24 * 3600_000);
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000);

    const [
      totalUsers,
      newUsers24h,
      totalProperties,
      publishedProperties,
      pendingReview,
      awaitingPayment,
      paidPayments,
      revenue,
      activeIncidents,
      readyReels,
      openReports,
      pendingVerifications,
      failedJobs,
      newProperties7d,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { createdAt: { gte: dayAgo } } }),
      this.prisma.property.count({ where: { deletedAt: null } }),
      this.prisma.property.count({ where: { status: 'PUBLISHED', deletedAt: null } }),
      this.prisma.property.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.property.count({ where: { status: 'AWAITING_PAYMENT' } }),
      this.prisma.listingPayment.count({ where: { status: 'PAID' } }),
      this.prisma.listingPayment.aggregate({ where: { status: 'PAID' }, _sum: { amountIqd: true } }),
      this.prisma.roadIncident.count({ where: { status: 'ACTIVE', expiresAt: { gt: new Date() } } }),
      this.prisma.propertyVideo.count({ where: { status: 'READY' } }),
      this.prisma.propertyReport.count({ where: { status: 'OPEN' } }),
      this.prisma.sellerVerification.count({ where: { status: 'PENDING' } }),
      this.prisma.aiJob.count({ where: { status: 'FAILED', createdAt: { gte: weekAgo } } }),
      this.prisma.property.count({ where: { createdAt: { gte: weekAgo }, deletedAt: null } }),
    ]);

    const queueStats = await this.queue.stats().catch(() => ({}));

    return {
      users: { total: totalUsers, new24h: newUsers24h },
      properties: {
        total: totalProperties,
        published: publishedProperties,
        pendingReview,
        awaitingPayment,
        new7d: newProperties7d,
      },
      payments: {
        paidCount: paidPayments,
        revenueIqd: revenue._sum.amountIqd ?? 0,
        standardFeeIqd: LISTING_FEE_IQD,
      },
      content: { activeIncidents, readyReels },
      queues: {
        openReports,
        pendingVerifications,
        failedAiJobs7d: failedJobs,
        bull: queueStats,
      },
      actionRequired: pendingReview + openReports + pendingVerifications,
    };
  }

  // ---------------------------------------------------------------------------
  // Property moderation — Master Plan §6 step 10
  // ---------------------------------------------------------------------------

  async listProperties(params: {
    status?: string;
    q?: string;
    governorate?: string;
    ownerId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(params.limit ?? 25, 100);

    const where = {
      deletedAt: null,
      ...(params.status ? { status: params.status as PropertyStatus } : {}),
      ...(params.governorate ? { governorate: params.governorate } : {}),
      ...(params.ownerId ? { ownerId: params.ownerId } : {}),
      ...(params.q
        ? {
            OR: [
              { title: { contains: params.q, mode: 'insensitive' as const } },
              { reference: { contains: params.q.toUpperCase() } },
              { district: { contains: params.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.property.findMany({
        where,
        orderBy: params.status === 'PENDING_REVIEW' ? { submittedAt: 'asc' } : { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          owner: { select: { id: true, phoneE164: true, displayName: true, sellerType: true } },
          media: { where: { isSelected: true }, take: 1, orderBy: { position: 'asc' } },
          payments: { where: { status: 'PAID' }, take: 1 },
        },
      }),
      this.prisma.property.count({ where }),
    ]);

    return {
      items: await Promise.all(
        items.map(async (p) => ({
          id: p.id,
          reference: p.reference,
          title: p.title,
          status: p.status,
          type: p.type,
          purpose: p.purpose,
          priceIqd: p.priceIqd.toString(),
          areaSqm: p.areaSqm.toString(),
          governorate: p.governorate,
          district: p.district,
          photoCount: p.photoCount,
          isPaid: p.payments.length > 0,
          owner: p.owner,
          coverUrl: p.media[0] ? await this.storage.publicOrSignedUrl(p.media[0].objectKey).catch(() => null) : null,
          submittedAt: p.submittedAt,
          publishedAt: p.publishedAt,
          createdAt: p.createdAt,
        })),
      ),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Full review payload: photos, reel, contact data, payment and history. */
  async getPropertyForReview(propertyId: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      include: {
        location: true,
        owner: { include: { sellerProfile: true } },
        media: { orderBy: { position: 'asc' }, include: { aiJobs: { orderBy: { createdAt: 'desc' }, take: 1 } } },
        videos: true,
        payments: { orderBy: { createdAt: 'desc' } },
        reports: { where: { status: { in: ['OPEN', 'REVIEWING'] } } },
        statusEvents: { orderBy: { createdAt: 'desc' }, take: 30 },
      },
    });
    if (!property) throw AppError.notFound({ message: 'Listing not found' });

    return {
      id: property.id,
      reference: property.reference,
      status: property.status,
      type: property.type,
      purpose: property.purpose,
      title: property.title,
      description: property.description,
      priceIqd: property.priceIqd.toString(),
      rentPeriod: property.rentPeriod,
      areaSqm: property.areaSqm.toString(),
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      floors: property.floors,
      governorate: property.governorate,
      city: property.city,
      district: property.district,
      addressLine: property.addressLine,
      // The reviewer sees the exact pin: verifying the location is the point of
      // the review. The approximate pin is what the public sees.
      location: property.location
        ? {
            lat: property.location.lat,
            lng: property.location.lng,
            publicLat: property.location.publicLat,
            publicLng: property.location.publicLng,
            precision: property.location.displayPrecision,
            placeLabel: property.location.placeLabel,
          }
        : null,
      contact: { preference: property.contactPreference, phone: property.contactPhone },
      owner: {
        id: property.owner.id,
        phone: property.owner.phoneE164,
        displayName: property.owner.displayName,
        sellerType: property.owner.sellerType,
        verification: property.owner.sellerProfile?.verification ?? 'NONE',
        officeName: property.owner.sellerProfile?.officeName ?? null,
      },
      photos: await Promise.all(
        property.media.map(async (m) => ({
          id: m.id,
          kind: m.kind,
          url: await this.storage.publicOrSignedUrl(m.objectKey).catch(() => null),
          width: m.width,
          height: m.height,
          position: m.position,
          isSelected: m.isSelected,
          uploadConfirmed: m.uploadConfirmed,
          qualityScore: m.qualityScore,
          qualityNotes: m.qualityNotes,
          sourceMediaId: m.sourceMediaId,
          enhancement: m.aiJobs[0]
            ? { status: m.aiJobs[0].status, provider: m.aiJobs[0].provider, model: m.aiJobs[0].model, operations: m.aiJobs[0].operations }
            : null,
        })),
      ),
      photoCount: property.photoCount,
      reels: property.videos.map((v) => ({
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
      })),
      payments: property.payments.map((p) => ({
        id: p.id,
        status: p.status,
        amountIqd: p.amountIqd,
        provider: p.provider,
        merchantRef: p.merchantRef,
        providerRef: p.providerRef,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
      })),
      openReports: property.reports.map((r) => ({ id: r.id, reason: r.reason, note: r.note, createdAt: r.createdAt })),
      history: property.statusEvents.map((e) => ({
        from: e.fromStatus,
        to: e.toStatus,
        actorType: e.actorType,
        reason: e.reason,
        at: e.createdAt,
      })),
      moderationReason: property.moderationReason,
    };
  }

  async approveProperty(propertyId: string, ctx: AdminContext, note?: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { id: true, status: true, ownerId: true, reference: true, photoCount: true },
    });
    if (!property) throw AppError.notFound({ message: 'Listing not found' });

    // Belt and braces: the DB constraint also forbids publishing outside 8–18,
    // but failing here gives the moderator a clear message instead of a
    // constraint violation.
    if (property.photoCount < 8 || property.photoCount > 18) {
      throw new AppError(422, {
        code: property.photoCount < 8 ? ErrorCode.PHOTO_COUNT_TOO_LOW : ErrorCode.PHOTO_COUNT_TOO_HIGH,
        message: `This listing has ${property.photoCount} photos and cannot be published (8–18 required)`,
        details: { photoCount: property.photoCount },
      });
    }

    // A listing must have been paid for before it can be published.
    const paid = await this.prisma.listingPayment.count({ where: { propertyId, status: 'PAID' } });
    if (paid === 0) {
      throw new AppError(402, {
        code: ErrorCode.PAYMENT_REQUIRED,
        message: 'This listing has no settled payment and cannot be published',
        details: { requiredAmountIqd: LISTING_FEE_IQD },
      });
    }

    await this.properties.applyTransition(propertyId, property.status, 'approve', 'ADMIN', ctx.adminId, note ?? null);
    await this.prisma.property.update({
      where: { id: propertyId },
      data: { moderatedByAdminId: ctx.adminId, moderatedAt: new Date() },
    });

    await this.audit.record({
      adminId: ctx.adminId,
      action: 'property.approve',
      entityType: 'property',
      entityId: propertyId,
      changes: { from: property.status, to: 'PUBLISHED' },
      reason: note,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });

    await this.notifications.notify(property.ownerId, {
      type: 'LISTING_APPROVED',
      titleAr: 'تم نشر إعلانك',
      titleEn: 'Your listing is live',
      bodyAr: `تمت الموافقة على إعلان ${property.reference} وهو الآن منشور في داركم.`,
      bodyEn: `Listing ${property.reference} was approved and is now published on Darcom.`,
      deepLink: `rivo://property/${propertyId}`,
    });

    return { id: propertyId, status: 'PUBLISHED' };
  }

  /** Rejection always carries a reason, which the seller sees verbatim. */
  async rejectProperty(propertyId: string, ctx: AdminContext, reason: string) {
    if (!reason || reason.trim().length < 10) {
      throw AppError.badRequest({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'A rejection must include a reason of at least 10 characters — the seller is shown this text',
      });
    }

    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { id: true, status: true, ownerId: true, reference: true },
    });
    if (!property) throw AppError.notFound({ message: 'Listing not found' });

    await this.properties.applyTransition(propertyId, property.status, 'reject', 'ADMIN', ctx.adminId, reason);
    await this.prisma.property.update({
      where: { id: propertyId },
      data: { moderatedByAdminId: ctx.adminId, moderatedAt: new Date() },
    });

    await this.audit.record({
      adminId: ctx.adminId,
      action: 'property.reject',
      entityType: 'property',
      entityId: propertyId,
      changes: { from: property.status, to: 'REJECTED' },
      reason,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });

    await this.notifications.notify(property.ownerId, {
      type: 'LISTING_REJECTED',
      titleAr: 'لم يتم قبول إعلانك',
      titleEn: 'Your listing was not approved',
      bodyAr: `إعلان ${property.reference}: ${reason}`,
      bodyEn: `Listing ${property.reference}: ${reason}`,
      deepLink: `rivo://property/${propertyId}`,
    });

    return { id: propertyId, status: 'REJECTED', reason };
  }

  async requestChanges(propertyId: string, ctx: AdminContext, reason: string) {
    if (!reason || reason.trim().length < 10) {
      throw AppError.badRequest({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Explain what must change — the seller is shown this text',
      });
    }

    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { id: true, status: true, ownerId: true, reference: true },
    });
    if (!property) throw AppError.notFound({ message: 'Listing not found' });

    await this.properties.applyTransition(propertyId, property.status, 'requestChanges', 'ADMIN', ctx.adminId, reason);

    await this.audit.record({
      adminId: ctx.adminId,
      action: 'property.request_changes',
      entityType: 'property',
      entityId: propertyId,
      reason,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    await this.notifications.notify(property.ownerId, {
      type: 'CHANGES_REQUESTED',
      titleAr: 'مطلوب تعديل على إعلانك',
      titleEn: 'Changes requested on your listing',
      bodyAr: `إعلان ${property.reference}: ${reason}`,
      bodyEn: `Listing ${property.reference}: ${reason}`,
      deepLink: `rivo://property/${propertyId}/edit`,
    });

    return { id: propertyId, status: 'CHANGES_REQUESTED', reason };
  }

  /** Pulls a published listing back into review. Used when a report is upheld. */
  async unpublishProperty(propertyId: string, ctx: AdminContext, reason: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { id: true, status: true, ownerId: true, reference: true },
    });
    if (!property) throw AppError.notFound({ message: 'Listing not found' });

    await this.properties.applyTransition(propertyId, property.status, 'unpublish', 'ADMIN', ctx.adminId, reason);

    await this.audit.record({
      adminId: ctx.adminId,
      action: 'property.unpublish',
      entityType: 'property',
      entityId: propertyId,
      reason,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { id: propertyId, status: 'PENDING_REVIEW' };
  }
}
