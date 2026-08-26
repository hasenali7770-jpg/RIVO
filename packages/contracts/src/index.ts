/**
 * Shared RIVO API contracts.
 *
 * These zod schemas describe the request and response shapes the API and the
 * admin dashboard agree on. The API validates with class-validator DTOs (Nest's
 * pipe integration and Swagger generation both depend on those), while the admin
 * dashboard parses responses with the schemas here — so a breaking API change
 * shows up as a TypeScript error in the dashboard rather than a runtime surprise.
 *
 * The Flutter app mirrors the same shapes in `apps/mobile/lib/core/api/models/`.
 */
export * from './common';
export * from './auth';
export * from './property';
export * from './media';
export * from './payment';
export * from './reel';
export * from './maps';
export * from './admin';
