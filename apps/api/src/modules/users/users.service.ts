import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GeoRepository } from '../../common/geo/geo.repository';
import { StorageService } from '../../integrations/r2/storage.service';
import { AppError } from '../../common/errors/app-error';
import { SavePlaceDto, UpdatePrivacyDto, UpdateProfileDto, UpdateSellerProfileDto } from './dto/user.dto';
import type { SellerType } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoRepository,
    private readonly storage: StorageService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { sellerProfile: true },
    });
    if (!user) throw AppError.notFound({ message: 'User not found' });

    const [listingsCount, favoritesCount] = await Promise.all([
      this.prisma.property.count({ where: { ownerId: userId, deletedAt: null } }),
      this.prisma.favorite.count({ where: { userId } }),
    ]);

    return {
      id: user.id,
      phone: user.phoneE164,
      phoneVerified: user.phoneVerified,
      displayName: user.displayName,
      avatarUrl: user.avatarKey ? await this.storage.publicOrSignedUrl(user.avatarKey).catch(() => null) : null,
      sellerType: user.sellerType,
      locale: user.locale,
      telemetryOptIn: user.telemetryOptIn,
      marketingOptIn: user.marketingOptIn,
      createdAt: user.createdAt,
      stats: { listingsCount, favoritesCount },
      sellerProfile: user.sellerProfile
        ? {
            sellerType: user.sellerProfile.sellerType,
            officeName: user.sellerProfile.officeName,
            about: user.sellerProfile.about,
            contactPhone: user.sellerProfile.contactPhone,
            whatsappPhone: user.sellerProfile.whatsappPhone,
            // The badge is shown only on a true VERIFIED state (Master Plan §8).
            verification: user.sellerProfile.verification,
            isVerified: user.sellerProfile.verification === 'VERIFIED',
            verifiedAt: user.sellerProfile.verifiedAt,
          }
        : null,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
        ...(dto.locale !== undefined ? { locale: dto.locale } : {}),
        ...(dto.sellerType !== undefined ? { sellerType: dto.sellerType as SellerType } : {}),
        ...(dto.avatarKey !== undefined ? { avatarKey: dto.avatarKey } : {}),
        ...(dto.marketingOptIn !== undefined ? { marketingOptIn: dto.marketingOptIn } : {}),
      },
    });
    return this.getProfile(userId);
  }

  /**
   * Telemetry consent — Master Plan §4 requires explicit opt-in and a working
   * opt-out. Withdrawing consent deletes the raw samples already collected;
   * only the anonymous aggregates, which cannot be traced to a person, remain.
   */
  async updatePrivacy(userId: string, dto: UpdatePrivacyDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.telemetryOptIn !== undefined
          ? { telemetryOptIn: dto.telemetryOptIn, telemetryOptInAt: dto.telemetryOptIn ? new Date() : null }
          : {}),
        ...(dto.marketingOptIn !== undefined ? { marketingOptIn: dto.marketingOptIn } : {}),
      },
      select: { telemetryOptIn: true, marketingOptIn: true, telemetryOptInAt: true },
    });
    return user;
  }

  async upsertSellerProfile(userId: string, dto: UpdateSellerProfileDto) {
    const sellerType = (dto.sellerType ?? 'INDIVIDUAL') as SellerType;
    const profile = await this.prisma.sellerProfile.upsert({
      where: { userId },
      create: {
        userId,
        sellerType,
        officeName: dto.officeName,
        officeLicenseNo: dto.officeLicenseNo,
        about: dto.about,
        contactPhone: dto.contactPhone,
        whatsappPhone: dto.whatsappPhone,
        logoKey: dto.logoKey,
      },
      update: {
        ...(dto.sellerType !== undefined ? { sellerType } : {}),
        ...(dto.officeName !== undefined ? { officeName: dto.officeName } : {}),
        ...(dto.officeLicenseNo !== undefined ? { officeLicenseNo: dto.officeLicenseNo } : {}),
        ...(dto.about !== undefined ? { about: dto.about } : {}),
        ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone } : {}),
        ...(dto.whatsappPhone !== undefined ? { whatsappPhone: dto.whatsappPhone } : {}),
        ...(dto.logoKey !== undefined ? { logoKey: dto.logoKey } : {}),
      },
    });

    if (dto.sellerType) {
      await this.prisma.user.update({ where: { id: userId }, data: { sellerType } });
    }
    return profile;
  }

  /**
   * Requests seller verification. Changing the account type does NOT grant a
   * badge: only an admin decision moves the profile to VERIFIED (Master Plan §8).
   */
  async requestVerification(userId: string, params: { requestedType: SellerType; documentKeys: string[]; note?: string }) {
    const pending = await this.prisma.sellerVerification.findFirst({
      where: { userId, status: 'PENDING' },
    });
    if (pending) {
      throw AppError.conflict({
        message: 'A verification request is already pending review',
        messageAr: 'لديك طلب توثيق قيد المراجعة بالفعل.',
      });
    }

    const verification = await this.prisma.sellerVerification.create({
      data: {
        userId,
        requestedType: params.requestedType,
        documentKeys: params.documentKeys,
        note: params.note,
        status: 'PENDING',
      },
    });

    await this.prisma.sellerProfile.upsert({
      where: { userId },
      create: { userId, sellerType: params.requestedType, verification: 'PENDING' },
      update: { verification: 'PENDING' },
    });

    return { id: verification.id, status: verification.status, createdAt: verification.createdAt };
  }

  async listSavedPlaces(userId: string) {
    return this.prisma.savedPlace.findMany({
      where: { userId },
      orderBy: [{ kind: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, kind: true, label: true, lat: true, lng: true, address: true, createdAt: true },
    });
  }

  async saveePlace(userId: string, dto: SavePlaceDto) {
    // HOME and WORK are singletons per user (enforced by a partial unique index),
    // so saving one replaces the existing row rather than failing.
    const existing =
      dto.kind === 'CUSTOM'
        ? null
        : await this.prisma.savedPlace.findFirst({ where: { userId, kind: dto.kind } });

    const id = existing?.id ?? randomUUID();
    await this.geo.upsertSavedPlace({
      id,
      userId,
      kind: dto.kind,
      label: dto.label,
      point: { lat: dto.lat, lng: dto.lng },
      address: dto.address ?? null,
    });

    return this.prisma.savedPlace.findUniqueOrThrow({
      where: { id },
      select: { id: true, kind: true, label: true, lat: true, lng: true, address: true },
    });
  }

  async deleteSavedPlace(userId: string, id: string) {
    const result = await this.prisma.savedPlace.deleteMany({ where: { id, userId } });
    if (result.count === 0) throw AppError.notFound({ message: 'Saved place not found' });
  }

  async listDevices(userId: string) {
    return this.prisma.userDevice.findMany({
      where: { userId },
      orderBy: { lastActiveAt: 'desc' },
      select: { id: true, platform: true, model: true, appVersion: true, osVersion: true, lastActiveAt: true },
    });
  }
}
