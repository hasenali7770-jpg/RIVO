import { z } from 'zod';
import { ADMIN_ROLES } from '@rivo/config';

export const adminSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  role: z.enum(ADMIN_ROLES),
  mustChangePassword: z.boolean().optional(),
});
export type Admin = z.infer<typeof adminSchema>;

export const adminLoginResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  admin: adminSchema,
});
export type AdminLoginResponse = z.infer<typeof adminLoginResponseSchema>;

export const dashboardSchema = z.object({
  users: z.object({ total: z.number().int(), new24h: z.number().int() }),
  properties: z.object({
    total: z.number().int(),
    published: z.number().int(),
    pendingReview: z.number().int(),
    awaitingPayment: z.number().int(),
    new7d: z.number().int(),
  }),
  payments: z.object({
    paidCount: z.number().int(),
    revenueIqd: z.number().int(),
    standardFeeIqd: z.number().int(),
  }),
  content: z.object({ activeIncidents: z.number().int(), readyReels: z.number().int() }),
  queues: z.object({
    openReports: z.number().int(),
    pendingVerifications: z.number().int(),
    failedAiJobs7d: z.number().int(),
    bull: z.record(
      z.object({
        waiting: z.number().int(),
        active: z.number().int(),
        failed: z.number().int(),
        delayed: z.number().int(),
      }),
    ),
  }),
  actionRequired: z.number().int(),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

export const featureFlagSchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
  /** enabled AND the credential the feature needs is present. */
  effective: z.boolean(),
  /** True when an operator turned it on but a credential is missing. */
  blockedByMissingCredential: z.boolean(),
  description: z.string().nullable(),
  config: z.unknown().nullable(),
  updatedAt: z.string(),
});
export type FeatureFlag = z.infer<typeof featureFlagSchema>;

export const auditLogSchema = z.object({
  id: z.string().uuid(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  changes: z.unknown().nullable(),
  reason: z.string().nullable(),
  ip: z.string().nullable(),
  requestId: z.string().nullable(),
  createdAt: z.string(),
  admin: z
    .object({
      id: z.string().uuid(),
      email: z.string(),
      displayName: z.string(),
      role: z.enum(ADMIN_ROLES),
    })
    .nullable(),
});
export type AuditLog = z.infer<typeof auditLogSchema>;
