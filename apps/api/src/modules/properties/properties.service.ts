import { Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_GOVERNORATE,
  PROPERTY_PHOTO_MAX,
  PROPERTY_PHOTO_MIN,
  isWithinIraqBounds,
} from '@rivo/config';
import type { ContactPreference, ListingPurpose, Prisma, PropertyStatus, PropertyType, SellerType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GeoRepository } from '../../common/geo/geo.repository';
import { StorageService } from '../../integrations/r2/storage.service';
import { MapboxService } from '../../integrations/mapbox/mapbox.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { generateReference } from '../../common/crypto/hash';
import { jitterPoint } from '../../common/geo/geo.util';
import { CreatePropertyDto, ReorderMediaDto, SearchPropertiesDto, UpdatePropertyDto } from './dto/property.dto';
import { PropertySearchRepository } from './property-search.repository';
import { EDITABLE_STATUSES, TransitionActor, TransitionName, canTransition, isEditable, targetStatus } from './property-state';

@Injectable()
export class PropertiesService {
  private readonly logger = new Logger(PropertiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoRepository,
    private readonly search: PropertySearchRepository,
    private readonly storage: StorageService,
    private readonly mapbox: MapboxService,
    private readonly flags: FeatureFlagsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Create / update
  // ---------------------------------------------------------------------------

  async create(userId: string, dto: CreatePropertyDto) {
    this.assertCoordinatesUsable(dto.lat, dto.lng);
    this.assertRentPeriod(dto.purpose, dto.rentPeriod);

    const price = this.parsePrice(dto.priceIqd);
    const reference = await this.allocateReference();
    const seller = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { sellerType: true, phoneE164: true },
    });

    const property = await this.prisma.property.create({
      data: {
        reference,
        ownerId: userId,
        type: dto.type as PropertyType,
        purpose: dto.purpose as ListingPurpose,
        status: 'DRAFT',
        title: dto.title,
        description: dto.description,
        priceIqd: price,
        rentPeriod: dto.purpose === 'RENT' ? (dto.rentPeriod ?? 'MONTHLY') : null,
        areaSqm: dto.areaSqm,
        bedrooms: dto.bedrooms,
        bathrooms: dto.bathrooms,
        floors: dto.floors,
        floorNumber: dto.floorNumber,
        yearBuilt: dto.yearBuilt,
        furnished: dto.furnished,
        governorate: dto.governorate ?? DEFAULT_GOVERNORATE,
        city: dto.city,
        district: dto.district,
        addressLine: dto.addressLine,
        contactPreference: (dto.contactPreference ?? 'BOTH') as ContactPreference,
        contactPhone: dto.contactPhone ?? seller.phoneE164,
        sellerType: seller.sellerType as SellerType,
      },
    });

    await this.writeLocation(property.id, dto.lat, dto.lng, dto.displayPrecision);
    await this.recordStatusEvent(property.id, null, 'DRAFT', 'USER', userId, 'Listing created');

    return this.getForOwner(property.id, userId);
  }

  async update(propertyId: string, userId: string, dto: UpdatePropertyDto) {
    const property = await this.loadOwned(propertyId, userId);

    if (!isEditable(property.status)) {
      throw new AppError(409, {
        code: ErrorCode.PROPERTY_INVALID_STATE,
        message: `A listing in status ${property.status} cannot be edited. Editable statuses: ${EDITABLE_STATUSES.join(', ')}.`,
        messageAr: 'لا يمكن تعديل الإعلان في حالته الحالية.',
        details: { status: property.status, editableStatuses: EDITABLE_STATUSES },
      });
    }

    if (dto.purpose || dto.rentPeriod) {
      this.assertRentPeriod(dto.purpose ?? property.purpose, dto.rentPeriod ?? property.rentPeriod ?? undefined);
    }

    const data: Prisma.PropertyUpdateInput = {
      ...(dto.type !== undefined ? { type: dto.type as PropertyType } : {}),
      ...(dto.purpose !== undefined ? { purpose: dto.purpose as ListingPurpose } : {}),
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.priceIqd !== undefined ? { priceIqd: this.parsePrice(dto.priceIqd) } : {}),
      ...(dto.rentPeriod !== undefined ? { rentPeriod: dto.rentPeriod } : {}),
      ...(dto.areaSqm !== undefined ? { areaSqm: dto.areaSqm } : {}),
      ...(dto.bedrooms !== undefined ? { bedrooms: dto.bedrooms } : {}),
      ...(dto.bathrooms !== undefined ? { bathrooms: dto.bathrooms } : {}),
      ...(dto.floors !== undefined ? { floors: dto.floors } : {}),
      ...(dto.floorNumber !== undefined ? { floorNumber: dto.floorNumber } : {}),
      ...(dto.yearBuilt !== undefined ? { yearBuilt: dto.yearBuilt } : {}),
      ...(dto.furnished !== undefined ? { furnished: dto.furnished } : {}),
      ...(dto.governorate !== undefined ? { governorate: dto.governorate } : {}),
      ...(dto.city !== undefined ? { city: dto.city } : {}),
      ...(dto.district !== undefined ? { district: dto.district } : {}),
      ...(dto.addressLine !== undefined ? { addressLine: dto.addressLine } : {}),
      ...(dto.contactPreference !== undefined
        ? { contactPreference: dto.contactPreference as ContactPreference }
        : {}),
      ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone } : {}),
    };

    await this.prisma.property.update({ where: { id: propertyId }, data });

    if (dto.lat !== undefined && dto.lng !== undefined) {
      this.assertCoordinatesUsable(dto.lat, dto.lng);
      await this.writeLocation(propertyId, dto.lat, dto.lng, dto.displayPrecision);
    }

    return this.getForOwner(propertyId, userId);
  }

  /**
   * Submits a completed listing for payment.
   *
   * This is where the 8–18 photo rule is enforced on the server (Master Plan §6
   * step 5). Only ORIGINAL photos whose upload has been confirmed against R2
   * count — a client cannot reach the minimum by claiming uploads that never
   * landed.
   */
  async submit(propertyId: string, userId: string) {
    const property = await this.loadOwned(propertyId, userId);

    if (!canTransition('submit', property.status, 'USER')) {
      throw new AppError(409, {
        code: ErrorCode.PROPERTY_INVALID_STATE,
        message: `A listing in status ${property.status} cannot be submitted`,
        messageAr: 'لا يمكن إرسال الإعلان في حالته الحالية.',
        details: { status: property.status },
      });
    }

    const photoCount = await this.prisma.propertyMedia.count({
      where: { propertyId, kind: 'ORIGINAL', uploadConfirmed: true },
    });

    if (photoCount < PROPERTY_PHOTO_MIN) {
      throw new AppError(422, {
        code: ErrorCode.PHOTO_COUNT_TOO_LOW,
        message: `A listing needs at least ${PROPERTY_PHOTO_MIN} photos. This listing has ${photoCount}.`,
        messageAr: `يجب رفع ${PROPERTY_PHOTO_MIN} صور على الأقل. لديك حالياً ${photoCount} صورة.`,
        details: { photoCount, minimum: PROPERTY_PHOTO_MIN, maximum: PROPERTY_PHOTO_MAX },
      });
    }
    if (photoCount > PROPERTY_PHOTO_MAX) {
      throw new AppError(422, {
        code: ErrorCode.PHOTO_COUNT_TOO_HIGH,
        message: `A listing may have at most ${PROPERTY_PHOTO_MAX} photos. This listing has ${photoCount}.`,
        messageAr: `الحد الأعلى ${PROPERTY_PHOTO_MAX} صورة. لديك حالياً ${photoCount} صورة.`,
        details: { photoCount, minimum: PROPERTY_PHOTO_MIN, maximum: PROPERTY_PHOTO_MAX },
      });
    }

    const missing = this.findMissingFields(property);
    if (missing.length > 0) {
      throw new AppError(422, {
        code: ErrorCode.PROPERTY_INCOMPLETE,
        message: `The listing is missing required information: ${missing.join(', ')}`,
        messageAr: 'يرجى إكمال بيانات الإعلان قبل الإرسال.',
        details: { missingFields: missing },
      });
    }

    const location = await this.prisma.propertyLocation.findUnique({ where: { propertyId } });
    if (!location) {
      throw new AppError(422, {
        code: ErrorCode.PROPERTY_INCOMPLETE,
        message: 'The listing has no map location',
        messageAr: 'يرجى تحديد موقع العقار على الخريطة.',
        details: { missingFields: ['location'] },
      });
    }

    // The listing fee is charged once. A listing that was rejected, fixed and
    // resubmitted must not be sent back to the payment step: creating a second
    // payment is refused with PAYMENT_ALREADY_PAID, which would leave the
    // listing stuck in AWAITING_PAYMENT with no way out.
    const settledPayment = await this.prisma.listingPayment.findFirst({
      where: { propertyId, status: 'PAID' },
      select: { id: true },
    });

    if (settledPayment) {
      await this.prisma.property.update({
        where: { id: propertyId },
        data: { status: 'PENDING_REVIEW', submittedAt: new Date(), moderationReason: null },
      });
      await this.recordStatusEvent(
        propertyId,
        property.status,
        'PENDING_REVIEW',
        'USER',
        userId,
        'Resubmitted after moderation — listing fee already settled',
      );

      return {
        id: propertyId,
        status: 'PENDING_REVIEW' as PropertyStatus,
        photoCount,
        nextStep: 'REVIEW',
        message: 'The listing is back with the review team. The fee was already paid.',
        messageAr: 'تم إرسال الإعلان إلى المراجعة. رسوم النشر مدفوعة مسبقاً.',
      };
    }

    await this.prisma.property.update({
      where: { id: propertyId },
      data: { status: 'AWAITING_PAYMENT', submittedAt: new Date(), moderationReason: null },
    });
    await this.recordStatusEvent(propertyId, property.status, 'AWAITING_PAYMENT', 'USER', userId, 'Submitted for payment');

    return {
      id: propertyId,
      status: 'AWAITING_PAYMENT' as PropertyStatus,
      photoCount,
      nextStep: 'PAYMENT',
      message: 'Create a payment to send this listing to review.',
      messageAr: 'يرجى دفع رسوم النشر لإرسال الإعلان إلى المراجعة.',
    };
  }

  /** Moves a rejected or changes-requested listing back to DRAFT so it can be edited. */
  async reopenForEdit(propertyId: string, userId: string) {
    const property = await this.loadOwned(propertyId, userId);
    if (!canTransition('reopenForEdit', property.status, 'USER')) {
      throw new AppError(409, {
        code: ErrorCode.PROPERTY_INVALID_STATE,
        message: `A listing in status ${property.status} cannot be reopened for editing`,
        details: { status: property.status },
      });
    }
    await this.applyTransition(propertyId, property.status, 'reopenForEdit', 'USER', userId, null);
    return { id: propertyId, status: 'DRAFT' as PropertyStatus };
  }

  async changeLifecycle(propertyId: string, userId: string, action: 'archive' | 'markSold' | 'markRented') {
    const property = await this.loadOwned(propertyId, userId);
    if (!canTransition(action, property.status, 'USER')) {
      throw new AppError(409, {
        code: ErrorCode.PROPERTY_INVALID_STATE,
        message: `Cannot ${action} a listing in status ${property.status}`,
        details: { status: property.status },
      });
    }
    const to = await this.applyTransition(propertyId, property.status, action, 'USER', userId, null);
    return { id: propertyId, status: to };
  }

  /**
   * Applies a state transition and records it. Every status change in the system
   * goes through here so `property_status_events` is a complete history.
   */
  async applyTransition(
    propertyId: string,
    from: PropertyStatus,
    name: TransitionName,
    actor: TransitionActor,
    actorId: string | null,
    reason: string | null,
  ): Promise<PropertyStatus> {
    if (!canTransition(name, from, actor)) {
      throw new AppError(409, {
        code: ErrorCode.PROPERTY_INVALID_STATE,
        message: `Transition "${name}" is not permitted from ${from} by ${actor}`,
        details: { transition: name, from, actor },
      });
    }
    const to = targetStatus(name);

    await this.prisma.property.update({
      where: { id: propertyId },
      data: {
        status: to,
        ...(to === 'PUBLISHED' ? { publishedAt: new Date(), moderationReason: null } : {}),
        ...(to === 'REJECTED' || to === 'CHANGES_REQUESTED' ? { moderationReason: reason } : {}),
        ...(to === 'DRAFT' ? { submittedAt: null } : {}),
      },
    });
    await this.recordStatusEvent(propertyId, from, to, actor, actorId, reason);
    return to;
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async searchPublic(dto: SearchPropertiesDto, viewerId: string | null) {
    const { rows, total, page, limit } = await this.search.search(dto, viewerId);
    const items = await Promise.all(rows.map((row) => this.toListItem(row)));
    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    };
  }

  async mapPins(bbox: string, filters: SearchPropertiesDto) {
    const parts = bbox.split(',').map(Number);
    if (parts.length !== 4 || !parts.every((n) => Number.isFinite(n))) {
      throw AppError.badRequest({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'bbox must be "minLng,minLat,maxLng,maxLat"',
      });
    }
    const pins = await this.search.mapPins({
      bbox: parts as [number, number, number, number],
      filters,
      limit: 500,
    });
    return {
      pins: pins.map((p) => ({
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        priceIqd: p.price_iqd.toString(),
        purpose: p.purpose,
        type: p.type,
        isVerified: p.is_verified_listing,
      })),
      truncated: pins.length >= 500,
    };
  }

  /** Public detail view. Increments the view counter and hides an exact pin when the seller chose APPROXIMATE. */
  async getPublic(propertyId: string, viewerId: string | null) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, status: 'PUBLISHED', deletedAt: null },
      include: {
        location: true,
        owner: { include: { sellerProfile: true } },
        media: {
          where: { uploadConfirmed: true, isSelected: true },
          orderBy: { position: 'asc' },
        },
        videos: { where: { status: 'READY' } },
      },
    });
    if (!property) throw AppError.notFound({ message: 'Listing not found', messageAr: 'الإعلان غير موجود.' });

    // Counted asynchronously so a slow write never delays the response.
    void this.prisma.property
      .update({ where: { id: propertyId }, data: { viewCount: { increment: 1 } } })
      .catch(() => undefined);

    const isFavorited = viewerId
      ? (await this.prisma.favorite.count({ where: { userId: viewerId, propertyId } })) > 0
      : false;

    return this.toDetail(property, { includeExactLocation: false, isFavorited });
  }

  /** Owner view: includes the exact pin, draft media, AI job state and moderation notes. */
  async getForOwner(propertyId: string, userId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, ownerId: userId, deletedAt: null },
      include: {
        location: true,
        owner: { include: { sellerProfile: true } },
        media: { orderBy: { position: 'asc' }, include: { aiJobs: { orderBy: { createdAt: 'desc' }, take: 1 } } },
        videos: true,
        payments: { orderBy: { createdAt: 'desc' }, take: 5 },
        statusEvents: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!property) throw AppError.notFound({ message: 'Listing not found' });

    const detail = await this.toDetail(property, { includeExactLocation: true, isFavorited: false });

    const photoCount = property.media.filter((m) => m.kind === 'ORIGINAL' && m.uploadConfirmed).length;

    return {
      ...detail,
      isOwner: true,
      moderation: {
        reason: property.moderationReason,
        moderatedAt: property.moderatedAt,
      },
      requirements: {
        photos: {
          current: photoCount,
          minimum: PROPERTY_PHOTO_MIN,
          maximum: PROPERTY_PHOTO_MAX,
          satisfied: photoCount >= PROPERTY_PHOTO_MIN && photoCount <= PROPERTY_PHOTO_MAX,
        },
        missingFields: this.findMissingFields(property),
        hasLocation: Boolean(property.location),
      },
      payments: property.payments.map((p) => ({
        id: p.id,
        status: p.status,
        amountIqd: p.amountIqd,
        provider: p.provider,
        createdAt: p.createdAt,
        paidAt: p.paidAt,
      })),
      history: property.statusEvents.map((e) => ({
        from: e.fromStatus,
        to: e.toStatus,
        actorType: e.actorType,
        reason: e.reason,
        at: e.createdAt,
      })),
      media: await Promise.all(
        property.media.map(async (m) => ({
          id: m.id,
          kind: m.kind,
          position: m.position,
          url: m.uploadConfirmed ? await this.storage.publicOrSignedUrl(m.objectKey).catch(() => null) : null,
          uploadConfirmed: m.uploadConfirmed,
          isSelected: m.isSelected,
          sourceMediaId: m.sourceMediaId,
          width: m.width,
          height: m.height,
          qualityScore: m.qualityScore,
          qualityNotes: m.qualityNotes,
          enhancement: m.aiJobs[0]
            ? {
                status: m.aiJobs[0].status,
                provider: m.aiJobs[0].provider,
                model: m.aiJobs[0].model,
                operations: m.aiJobs[0].operations,
                error: m.aiJobs[0].error,
                finishedAt: m.aiJobs[0].finishedAt,
              }
            : null,
        })),
      ),
    };
  }

  async listMine(userId: string, status?: string, page = 1, limit = 20) {
    const where = {
      ownerId: userId,
      deletedAt: null,
      ...(status ? { status: status as PropertyStatus } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.property.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { media: { where: { isSelected: true, uploadConfirmed: true }, take: 1, orderBy: { position: 'asc' } } },
      }),
      this.prisma.property.count({ where }),
    ]);

    const items = await Promise.all(
      rows.map(async (p) => ({
        id: p.id,
        reference: p.reference,
        title: p.title,
        status: p.status,
        type: p.type,
        purpose: p.purpose,
        priceIqd: p.priceIqd.toString(),
        areaSqm: p.areaSqm.toString(),
        photoCount: p.photoCount,
        coverUrl: p.media[0] ? await this.storage.publicOrSignedUrl(p.media[0].objectKey).catch(() => null) : null,
        moderationReason: p.moderationReason,
        publishedAt: p.publishedAt,
        updatedAt: p.updatedAt,
      })),
    );
    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  // ---------------------------------------------------------------------------
  // Favourites, reports, media ordering
  // ---------------------------------------------------------------------------

  async favorite(propertyId: string, userId: string) {
    const exists = await this.prisma.property.count({ where: { id: propertyId, status: 'PUBLISHED' } });
    if (!exists) throw AppError.notFound({ message: 'Listing not found' });
    await this.prisma.favorite.upsert({
      where: { userId_propertyId: { userId, propertyId } },
      create: { userId, propertyId },
      update: {},
    });
    return { favorited: true };
  }

  async unfavorite(propertyId: string, userId: string) {
    await this.prisma.favorite.deleteMany({ where: { userId, propertyId } });
    return { favorited: false };
  }

  async listFavorites(userId: string, page = 1, limit = 20) {
    const [rows, total] = await Promise.all([
      this.prisma.favorite.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          property: {
            include: { media: { where: { isSelected: true, uploadConfirmed: true }, take: 1, orderBy: { position: 'asc' } }, location: true },
          },
        },
      }),
      this.prisma.favorite.count({ where: { userId } }),
    ]);

    const items = await Promise.all(
      rows
        .filter((f) => f.property.status === 'PUBLISHED')
        .map(async (f) => ({
          id: f.property.id,
          reference: f.property.reference,
          title: f.property.title,
          type: f.property.type,
          purpose: f.property.purpose,
          priceIqd: f.property.priceIqd.toString(),
          areaSqm: f.property.areaSqm.toString(),
          governorate: f.property.governorate,
          district: f.property.district,
          lat: f.property.location?.publicLat ?? f.property.location?.lat ?? null,
          lng: f.property.location?.publicLng ?? f.property.location?.lng ?? null,
          coverUrl: f.property.media[0]
            ? await this.storage.publicOrSignedUrl(f.property.media[0].objectKey).catch(() => null)
            : null,
          savedAt: f.createdAt,
        })),
    );
    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async report(propertyId: string, reporterId: string | null, reason: string, note?: string) {
    const exists = await this.prisma.property.count({ where: { id: propertyId } });
    if (!exists) throw AppError.notFound({ message: 'Listing not found' });

    await this.prisma.propertyReport.create({
      data: { propertyId, reporterId, reason, note, status: 'OPEN' },
    });
    return {
      submitted: true,
      message: 'Thank you. Our team will review this listing.',
      messageAr: 'شكراً لك. سيقوم فريقنا بمراجعة هذا الإعلان.',
    };
  }

  /** Reorders the gallery and sets the cover. Only the owner, only while editable. */
  async reorderMedia(propertyId: string, userId: string, dto: ReorderMediaDto) {
    const property = await this.loadOwned(propertyId, userId);
    if (!isEditable(property.status) && property.status !== 'AWAITING_PAYMENT') {
      throw new AppError(409, {
        code: ErrorCode.PROPERTY_INVALID_STATE,
        message: `Media cannot be reordered while the listing is ${property.status}`,
        details: { status: property.status },
      });
    }

    const owned = await this.prisma.propertyMedia.findMany({
      where: { propertyId, id: { in: dto.mediaIds } },
      select: { id: true },
    });
    if (owned.length !== dto.mediaIds.length) {
      throw AppError.badRequest({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'One or more media ids do not belong to this listing',
      });
    }

    await this.prisma.$transaction(
      dto.mediaIds.map((id, index) =>
        this.prisma.propertyMedia.update({ where: { id }, data: { position: index } }),
      ),
    );

    if (dto.coverMediaId) {
      const cover = await this.prisma.propertyMedia.findFirst({
        where: { id: dto.coverMediaId, propertyId },
      });
      if (!cover) {
        throw AppError.badRequest({ code: ErrorCode.VALIDATION_FAILED, message: 'Cover media does not belong to this listing' });
      }
      await this.prisma.property.update({ where: { id: propertyId }, data: { coverMediaId: dto.coverMediaId } });
    }

    return this.getForOwner(propertyId, userId);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  async loadOwned(propertyId: string, userId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, ownerId: userId, deletedAt: null },
    });
    if (!property) {
      // 404 rather than 403: revealing that a listing exists but belongs to
      // someone else leaks information about other users' drafts.
      throw AppError.notFound({ message: 'Listing not found', messageAr: 'الإعلان غير موجود.' });
    }
    return property;
  }

  private async writeLocation(propertyId: string, lat: number, lng: number, precision?: string) {
    const approximate =
      precision === 'APPROXIMATE' && (await this.flags.isEnabled('approximate_location_option'));

    const publicPoint = approximate ? jitterPoint({ lat, lng }, 300, propertyId) : null;

    // Reverse geocoding is a nicety, not a requirement: a Mapbox outage must not
    // stop a seller from placing a pin.
    let placeLabel: string | null = null;
    if (this.mapbox.isConfigured) {
      try {
        const place = await this.mapbox.reverseGeocode({ lat, lng });
        placeLabel = place?.fullAddress ?? null;
      } catch (err) {
        this.logger.warn(`Reverse geocode failed for property ${propertyId}: ${err instanceof Error ? err.message : err}`);
      }
    }

    await this.geo.upsertPropertyLocation({
      propertyId,
      point: { lat, lng },
      publicPoint,
      displayPrecision: approximate ? 'APPROXIMATE' : 'EXACT',
      approxRadiusM: 300,
      placeLabel,
    });
  }

  private async recordStatusEvent(
    propertyId: string,
    from: PropertyStatus | null,
    to: PropertyStatus,
    actorType: TransitionActor,
    actorId: string | null,
    reason: string | null,
  ) {
    await this.prisma.propertyStatusEvent.create({
      data: { propertyId, fromStatus: from, toStatus: to, actorType, actorId, reason },
    });
  }

  private parsePrice(value: string): bigint {
    let price: bigint;
    try {
      price = BigInt(value);
    } catch {
      throw AppError.badRequest({ code: ErrorCode.VALIDATION_FAILED, message: 'priceIqd must be a whole number of dinars' });
    }
    if (price <= 0n) {
      throw AppError.badRequest({ code: ErrorCode.VALIDATION_FAILED, message: 'priceIqd must be greater than zero' });
    }
    // 10 trillion IQD is far above any real property; beyond it the value is a
    // typo or an attack on downstream formatting.
    if (price > 10_000_000_000_000n) {
      throw AppError.badRequest({ code: ErrorCode.VALIDATION_FAILED, message: 'priceIqd is unrealistically large' });
    }
    return price;
  }

  private assertCoordinatesUsable(lat: number, lng: number) {
    if (!isWithinIraqBounds(lng, lat)) {
      throw AppError.badRequest({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'The map pin must be inside Iraq',
        messageAr: 'يجب أن يكون موقع العقار داخل العراق.',
        details: { lat, lng },
      });
    }
  }

  private assertRentPeriod(purpose: string, rentPeriod?: string) {
    if (purpose === 'RENT' && rentPeriod && !['MONTHLY', 'YEARLY'].includes(rentPeriod)) {
      throw AppError.badRequest({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'rentPeriod must be MONTHLY or YEARLY for a rental listing',
      });
    }
  }

  private findMissingFields(property: {
    title: string;
    description: string | null;
    priceIqd: bigint;
    areaSqm: Prisma.Decimal;
    governorate: string;
    type: PropertyType;
    bedrooms: number | null;
    bathrooms: number | null;
    contactPhone: string | null;
  }): string[] {
    const missing: string[] = [];
    if (!property.title || property.title.trim().length < 8) missing.push('title');
    if (!property.description || property.description.trim().length < 20) missing.push('description');
    if (property.priceIqd <= 0n) missing.push('priceIqd');
    if (Number(property.areaSqm) <= 0) missing.push('areaSqm');
    if (!property.governorate) missing.push('governorate');
    if (!property.contactPhone) missing.push('contactPhone');

    // Room counts are meaningless for land and shops, so they are only required
    // for dwellings.
    const needsRooms: PropertyType[] = ['HOUSE', 'APARTMENT'];
    if (needsRooms.includes(property.type)) {
      if (property.bedrooms === null) missing.push('bedrooms');
      if (property.bathrooms === null) missing.push('bathrooms');
    }
    return missing;
  }

  private async allocateReference(): Promise<string> {
    // 32^6 ≈ 1.07 billion combinations; a handful of retries makes a collision
    // effectively impossible without a sequence table.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const reference = generateReference('RV', 6);
      const taken = await this.prisma.property.count({ where: { reference } });
      if (!taken) return reference;
    }
    throw new Error('Could not allocate a unique property reference after 6 attempts');
  }

  private async toListItem(row: PropertySearchRowLike) {
    return {
      id: row.id,
      reference: row.reference,
      type: row.type,
      purpose: row.purpose,
      title: row.title,
      priceIqd: row.price_iqd.toString(),
      rentPeriod: row.rent_period,
      areaSqm: row.area_sqm,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      governorate: row.governorate,
      city: row.city,
      district: row.district,
      sellerType: row.seller_type,
      isVerified: row.is_verified_listing,
      isDemo: row.is_demo,
      photoCount: row.photo_count,
      favoriteCount: row.favorite_count,
      viewCount: row.view_count,
      hasReel: row.has_reel,
      isFavorited: row.is_favorited ?? false,
      lat: row.display_lat,
      lng: row.display_lng,
      distanceM: row.distance_m === null ? null : Math.round(row.distance_m),
      coverUrl: row.cover_object_key
        ? await this.storage.publicOrSignedUrl(row.cover_object_key).catch(() => null)
        : null,
      publishedAt: row.published_at,
    };
  }

  private async toDetail(
    property: PropertyWithRelations,
    options: { includeExactLocation: boolean; isFavorited: boolean },
  ) {
    const location = property.location;
    const showExact = options.includeExactLocation || location?.displayPrecision === 'EXACT';

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
      floorNumber: property.floorNumber,
      yearBuilt: property.yearBuilt,
      furnished: property.furnished,
      governorate: property.governorate,
      city: property.city,
      district: property.district,
      addressLine: property.addressLine,
      isDemo: property.isDemo,
      location: location
        ? {
            // The exact pin is withheld from the public payload when the seller
            // chose an approximate display; the jittered point is served instead.
            lat: showExact ? location.lat : (location.publicLat ?? location.lat),
            lng: showExact ? location.lng : (location.publicLng ?? location.lng),
            precision: location.displayPrecision,
            approxRadiusM: location.displayPrecision === 'APPROXIMATE' ? location.approxRadiusM : 0,
            placeLabel: location.placeLabel,
          }
        : null,
      contact: {
        preference: property.contactPreference,
        phone: property.status === 'PUBLISHED' || options.includeExactLocation ? property.contactPhone : null,
      },
      seller: {
        id: property.owner.id,
        displayName: property.owner.displayName,
        sellerType: property.owner.sellerType,
        officeName: property.owner.sellerProfile?.officeName ?? null,
        // Master Plan §8: the badge appears only on a true VERIFIED state.
        isVerified: property.owner.sellerProfile?.verification === 'VERIFIED',
      },
      photos: await Promise.all(
        (property.media ?? [])
          .filter((m) => m.uploadConfirmed && m.isSelected)
          .map(async (m) => ({
            id: m.id,
            url: await this.storage.publicOrSignedUrl(m.objectKey).catch(() => null),
            kind: m.kind,
            width: m.width,
            height: m.height,
            position: m.position,
            isCover: m.id === property.coverMediaId,
          })),
      ),
      reel: (property.videos ?? []).find((v) => v.status === 'READY')
        ? (() => {
            const v = (property.videos ?? []).find((x) => x.status === 'READY')!;
            return {
              id: v.id,
              hlsUrl: v.playbackHlsUrl,
              dashUrl: v.playbackDashUrl,
              thumbnailUrl: v.thumbnailUrl,
              durationSeconds: v.durationSeconds,
              width: v.width,
              height: v.height,
              caption: v.caption,
            };
          })()
        : null,
      stats: {
        viewCount: property.viewCount,
        favoriteCount: property.favoriteCount,
      },
      isFavorited: options.isFavorited,
      publishedAt: property.publishedAt,
      createdAt: property.createdAt,
    };
  }
}

type PropertySearchRowLike = {
  id: string;
  reference: string;
  type: string;
  purpose: string;
  title: string;
  price_iqd: bigint;
  rent_period: string | null;
  area_sqm: string;
  bedrooms: number | null;
  bathrooms: number | null;
  governorate: string;
  city: string | null;
  district: string | null;
  seller_type: string;
  is_verified_listing: boolean;
  is_demo: boolean;
  photo_count: number;
  favorite_count: number;
  view_count: number;
  has_reel: boolean;
  is_favorited?: boolean;
  display_lat: number;
  display_lng: number;
  distance_m: number | null;
  cover_object_key: string | null;
  published_at: Date | null;
};

type PropertyWithRelations = Prisma.PropertyGetPayload<{
  include: {
    location: true;
    owner: { include: { sellerProfile: true } };
    media: true;
    videos: true;
  };
}>;
