import { PropertyStatus } from '@prisma/client';

/**
 * The Darcom listing state machine — Master Plan §6.
 *
 *   DRAFT ──submit──▶ AWAITING_PAYMENT ──webhook PAID──▶ PENDING_REVIEW
 *                                                            │
 *                        ┌───────────────────────────────────┼──────────────┐
 *                        ▼                                   ▼              ▼
 *                    PUBLISHED                           REJECTED    CHANGES_REQUESTED
 *                        │                                   │              │
 *          ┌─────────────┼─────────┐                         └──── edit ────┘
 *          ▼             ▼         ▼                                │
 *      ARCHIVED        SOLD      RENTED                             ▼
 *                                                                 DRAFT
 *
 * Two transitions are deliberately impossible:
 *   • AWAITING_PAYMENT → PENDING_REVIEW by anything except the payment layer.
 *   • anything → PUBLISHED except an admin approval from PENDING_REVIEW.
 */

export type TransitionActor = 'USER' | 'ADMIN' | 'SYSTEM' | 'PAYMENT_WEBHOOK';

interface Transition {
  from: PropertyStatus[];
  to: PropertyStatus;
  actors: TransitionActor[];
}

export const TRANSITIONS: Record<string, Transition> = {
  submit: { from: ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'], to: 'AWAITING_PAYMENT', actors: ['USER'] },
  // Only the payment layer may perform this, and only after a verified webhook
  // (or an audited manual settlement by a finance operator).
  paymentSettled: { from: ['AWAITING_PAYMENT'], to: 'PENDING_REVIEW', actors: ['PAYMENT_WEBHOOK', 'ADMIN'] },
  approve: { from: ['PENDING_REVIEW'], to: 'PUBLISHED', actors: ['ADMIN'] },
  reject: { from: ['PENDING_REVIEW'], to: 'REJECTED', actors: ['ADMIN'] },
  requestChanges: { from: ['PENDING_REVIEW'], to: 'CHANGES_REQUESTED', actors: ['ADMIN'] },
  reopenForEdit: { from: ['CHANGES_REQUESTED', 'REJECTED'], to: 'DRAFT', actors: ['USER'] },
  archive: { from: ['PUBLISHED'], to: 'ARCHIVED', actors: ['USER', 'ADMIN'] },
  markSold: { from: ['PUBLISHED'], to: 'SOLD', actors: ['USER', 'ADMIN'] },
  markRented: { from: ['PUBLISHED'], to: 'RENTED', actors: ['USER', 'ADMIN'] },
  unpublish: { from: ['PUBLISHED'], to: 'PENDING_REVIEW', actors: ['ADMIN'] },
  expirePayment: { from: ['AWAITING_PAYMENT'], to: 'DRAFT', actors: ['SYSTEM'] },
};

export type TransitionName = keyof typeof TRANSITIONS;

export function canTransition(name: TransitionName, from: PropertyStatus, actor: TransitionActor): boolean {
  const t = TRANSITIONS[name];
  if (!t) return false;
  return t.from.includes(from) && t.actors.includes(actor);
}

export function targetStatus(name: TransitionName): PropertyStatus {
  return TRANSITIONS[name].to;
}

/** Statuses in which the seller may still edit the listing content. */
export const EDITABLE_STATUSES: PropertyStatus[] = ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'];

/** Statuses visible to the public. */
export const PUBLIC_STATUSES: PropertyStatus[] = ['PUBLISHED'];

export function isEditable(status: PropertyStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}
