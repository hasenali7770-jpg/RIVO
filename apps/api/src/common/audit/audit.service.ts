import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  adminId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  changes?: Record<string, unknown> | null;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * Audit trail — Master Plan §9: "Every sensitive action must create an
 * audit-log entry."
 *
 * Writes are best-effort in the sense that a logging failure must never roll
 * back the business action the operator performed — but a failure is loudly
 * reported, never swallowed silently.
 *
 * The table itself is append-only, enforced by a database trigger (see the
 * initial migration), so an operator with database access still cannot rewrite
 * history through the application.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          adminId: entry.adminId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          changes: (redact(entry.changes) as object) ?? undefined,
          reason: entry.reason ?? null,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent?.slice(0, 512) ?? null,
          requestId: entry.requestId ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `FAILED TO WRITE AUDIT LOG for ${entry.action} on ${entry.entityType}:${entry.entityId ?? '-'} — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async list(params: {
    entityType?: string;
    entityId?: string;
    adminId?: string;
    action?: string;
    from?: Date;
    to?: Date;
    skip?: number;
    take?: number;
  }) {
    const where = {
      ...(params.entityType ? { entityType: params.entityType } : {}),
      ...(params.entityId ? { entityId: params.entityId } : {}),
      ...(params.adminId ? { adminId: params.adminId } : {}),
      ...(params.action ? { action: { contains: params.action } } : {}),
      ...(params.from || params.to
        ? { createdAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { admin: { select: { id: true, email: true, displayName: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        skip: params.skip ?? 0,
        take: Math.min(params.take ?? 50, 200),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total };
  }
}

/**
 * Strips anything secret-shaped before it is persisted. Audit entries are read by
 * support staff, so a token accidentally included in a diff must not survive
 * into a table that cannot be edited afterwards.
 */
const SECRET_KEY_PATTERN = /(password|secret|token|apikey|api_key|authorization|signature|credential)/i;

function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[truncated]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_PATTERN.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}
