/**
 * The enhancement allow-list — Master Plan §6 step 6 and §24
 * ("Do not make AI enhancement change the truth of the property").
 *
 * This is the enforcement point for that rule. An adapter may only report
 * operations from ALLOWED_OPERATIONS. Anything generative — adding or removing
 * furniture, altering rooms, inventing a view — is refused before a job is
 * created, so a future contributor cannot quietly wire in an inpainting model.
 */

export const ALLOWED_OPERATIONS = [
  'exposure',
  'white_balance',
  'denoise',
  'clarity',
  'sharpen',
  'super_resolution',
  'lens_correction',
  'perspective_correction',
  'color_correction',
  'smart_crop',
] as const;

export type AllowedOperation = (typeof ALLOWED_OPERATIONS)[number];

/**
 * Operations that materially change what the property is. Listed explicitly so
 * the prohibition is documented in code rather than only in prose.
 */
export const FORBIDDEN_OPERATIONS = [
  'add_furniture',
  'remove_furniture',
  'virtual_staging',
  'change_walls',
  'change_windows',
  'resize_room',
  'add_pool',
  'add_garden',
  'add_view',
  'replace_sky',
  'inpaint',
  'outpaint',
  'generative_fill',
  'object_removal',
] as const;

export type ForbiddenOperation = (typeof FORBIDDEN_OPERATIONS)[number];

export function isAllowedOperation(op: string): op is AllowedOperation {
  return (ALLOWED_OPERATIONS as readonly string[]).includes(op);
}

/**
 * Throws if any requested operation is outside the allow-list. Called before an
 * AI job is enqueued and again inside the worker, so neither an API caller nor a
 * queue entry can bypass it.
 */
export function assertOperationsAllowed(operations: string[]): asserts operations is AllowedOperation[] {
  const rejected = operations.filter((op) => !isAllowedOperation(op));
  if (rejected.length > 0) {
    throw new Error(
      `AI operations [${rejected.join(', ')}] are not permitted: RIVO photo enhancement may improve image quality but must never change what the property actually looks like. Allowed operations: ${ALLOWED_OPERATIONS.join(', ')}.`,
    );
  }
}

/** The default pipeline applied to a property photo. */
export const DEFAULT_PHOTO_OPERATIONS: AllowedOperation[] = [
  'exposure',
  'white_balance',
  'denoise',
  'clarity',
  'super_resolution',
];
