import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import type { AdminRole } from '@prisma/client';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';
import {
  AuthenticatedAdmin,
  ClientIp,
  CurrentAdmin,
  Public,
  RequireRoles,
  RivoRequest,
} from '../../common/decorators';
import { AdminAuthService } from './admin-auth.service';
import { AdminContext, AdminService } from './admin.service';
import { AdminOperationsService } from './admin-operations.service';
import {
  AdminLoginDto,
  BlockUserDto,
  ChangePasswordDto,
  CreateAdminDto,
  ModerationDecisionDto,
  RejectionDto,
  ResolveReportDto,
  SetActiveDto,
  SetFlagDto,
  SettlePaymentDto,
  VerificationDecisionDto,
} from './dto/admin.dto';
import { extractBearer } from '../../common/guards/jwt-auth.guard';

/**
 * Admin API — Master Plan §9.
 *
 * Guarded by AdminAuthGuard for the whole controller. Every route carries an
 * explicit @RequireRoles: the guard refuses any admin route that declares none,
 * so a forgotten decorator fails closed rather than opening a hole.
 */
@ApiTags('admin')
@ApiBearerAuth('admin')
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly admin: AdminService,
    private readonly ops: AdminOperationsService,
  ) {}

  private context(req: RivoRequest, admin: AuthenticatedAdmin, ip: string | null): AdminContext {
    return {
      adminId: admin.id,
      ip,
      userAgent: (req.headers['user-agent'] as string) ?? null,
      requestId: req.requestId,
    };
  }

  // --- Session ---------------------------------------------------------------

  @Public()
  // Only the adminAuth budget applies here (ADMIN_LOGIN_ATTEMPTS_PER_5MIN per IP,
  // taken from the module configuration). The real brute-force defence is the
  // per-account lockout in AdminAuthService, which an attacker cannot evade by
  // rotating addresses.
  @SkipThrottle({ default: true })
  @RateLimit('adminAuth')
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin sign-in',
    description: 'Five failed attempts lock the account for 15 minutes. Sessions are server-side and revocable.',
  })
  login(@Body() dto: AdminLoginDto, @ClientIp() ip: string | null, @Headers('user-agent') ua?: string) {
    return this.auth.login(dto.email, dto.password, ip, ua ?? null);
  }

  @RequireRoles('SUPER_ADMIN', 'MODERATOR', 'FINANCE', 'SUPPORT')
  @Post('auth/logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End this admin session' })
  logout(@CurrentAdmin() admin: AuthenticatedAdmin, @Req() req: RivoRequest) {
    const token = extractBearer(req.headers.authorization) ?? '';
    return this.auth.logout(admin.id, token);
  }

  @RequireRoles('SUPER_ADMIN', 'MODERATOR', 'FINANCE', 'SUPPORT')
  @Get('auth/me')
  @ApiOperation({ summary: 'The signed-in admin' })
  me(@CurrentAdmin() admin: AuthenticatedAdmin) {
    return admin;
  }

  @RequireRoles('SUPER_ADMIN', 'MODERATOR', 'FINANCE', 'SUPPORT')
  @Post('auth/change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change your password. Signs out every admin session.' })
  changePassword(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() dto: ChangePasswordDto,
    @ClientIp() ip: string | null,
  ) {
    return this.auth.changePassword(admin.id, dto.currentPassword, dto.newPassword, ip);
  }

  // --- Dashboard -------------------------------------------------------------

  @RequireRoles('SUPER_ADMIN', 'MODERATOR', 'FINANCE', 'SUPPORT')
  @Get('dashboard')
  @ApiOperation({ summary: 'Platform KPIs' })
  dashboard() {
    return this.admin.dashboard();
  }

  // --- Properties ------------------------------------------------------------

  @RequireRoles('SUPER_ADMIN', 'MODERATOR', 'SUPPORT')
  @Get('properties')
  @ApiOperation({ summary: 'List listings in any status' })
  listProperties(
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('governorate') governorate?: string,
    @Query('ownerId') ownerId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.listProperties({
      status,
      q,
      governorate,
      ownerId,
      page: Number(page) || 1,
      limit: Number(limit) || 25,
    });
  }

  @RequireRoles('SUPER_ADMIN', 'MODERATOR', 'SUPPORT')
  @Get('properties/:id')
  @ApiOperation({ summary: 'Full review payload for one listing' })
  getProperty(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getPropertyForReview(id);
  }

  @RequireRoles('SUPER_ADMIN', 'MODERATOR')
  @Post('properties/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve and publish a listing',
    description: 'Refused unless the listing has a settled payment and 8–18 photos.',
  })
  @ApiResponse({ status: 402, description: 'No settled payment for this listing.' })
  @ApiResponse({ status: 422, description: 'Photo count outside 8–18.' })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerationDecisionDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Req() req: RivoRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.admin.approveProperty(id, this.context(req, admin, ip), dto.note);
  }

  @RequireRoles('SUPER_ADMIN', 'MODERATOR')
  @Post('properties/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a listing with a reason shown to the seller' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectionDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Req() req: RivoRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.admin.rejectProperty(id, this.context(req, admin, ip), dto.reason);
  }

  @RequireRoles('SUPER_ADMIN', 'MODERATOR')
  @Post('properties/:id/request-changes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ask the seller to correct the listing and resubmit' })
  requestChanges(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectionDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Req() req: RivoRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.admin.requestChanges(id, this.context(req, admin, ip), dto.reason);
  }

  @RequireRoles('SUPER_ADMIN', 'MODERATOR')
  @Post('properties/:id/unpublish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pull a published listing back into review' })
  unpublish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectionDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Req() req: RivoRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.admin.unpublishProperty(id, this.context(req, admin, ip), dto.reason);
  }

  // --- Users -----------------------------------------------------------------

  @RequireRoles('SUPER_ADMIN', 'MODERATOR', 'SUPPORT')
  @Get('users')
  @ApiOperation({ summary: 'List users' })
  listUsers(
    @Query('q') q?: string,
    @Query('sellerType') sellerType?: string,
    @Query('blocked') blocked?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ops.listUsers({
      q,
      sellerType,
      blocked: blocked === undefined ? undefined : blocked === 'true',
      page: Number(page) || 1,
      limit: Number(limit) || 25,
    });
  }

  @RequireRoles('SUPER_ADMIN', 'MODERATOR', 'SUPPORT')
  @Get('users/:id')
  @ApiOperation({
    summary: 'One user with listings, payments and devices',
    description: 'Location history is never included — Master Plan §13 forbids exposing raw GPS tracks to admins.',
  })
  getUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.ops.getUser(id);
  }

  @RequireRoles('SUPER_ADMIN', 'MODERATOR')
  @Post('users/:id/block')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Block or unblock a user. Blocking revokes their sessions immediately.' })
  blockUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BlockUserDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Req() req: RivoRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.ops.setUserBlocked(id, dto.blocked, dto.reason ?? null, this.context(req, admin, ip));
  }

  // --- Payments --------------------------------------------------------------

  @RequireRoles('SUPER_ADMIN', 'FINANCE')
  @Get('payments')
  @ApiOperation({ summary: 'Payments and revenue' })
  listPayments(
    @Query('status') status?: string,
    @Query('propertyId') propertyId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ops.listPayments({ status, propertyId, page: Number(page) || 1, limit: Number(limit) || 25 });
  }

  @RequireRoles('SUPER_ADMIN', 'FINANCE')
  @Get('payments/:id/events')
  @ApiOperation({
    summary: 'Every webhook received for a payment',
    description: 'Includes rejected events with the reason, for dispute and abuse investigation.',
  })
  paymentEvents(@Param('id', ParseUUIDPipe) id: string) {
    return this.ops.listPaymentEvents(id);
  }

  @RequireRoles('SUPER_ADMIN', 'FINANCE')
  @Post('payments/:id/settle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record a payment received offline',
    description:
      'The only non-webhook route to PAID. Requires a settlement reference and an explanation, and writes an audit entry naming the operator. It exists for cash and bank transfers, not to simulate a gateway.',
  })
  settlePayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SettlePaymentDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Req() req: RivoRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.ops.settlePaymentManually(id, this.context(req, admin, ip), dto);
  }

  // --- Incidents -------------------------------------------------------------

  @RequireRoles('SUPER_ADMIN', 'MODERATOR', 'SUPPORT')
  @Get('incidents')
  @ApiOperation({ summary: 'Road incident reports' })
  listIncidents(
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ops.listIncidents({ status, type, page: Number(page) || 1, limit: Number(limit) || 25 });
  }

  @RequireRoles('SUPER_ADMIN', 'MODERATOR')
  @Post('incidents/:id/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Take a false or abusive report off the map' })
  removeIncident(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectionDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Req() req: RivoRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.ops.removeIncident(id, this.context(req, admin, ip), dto.reason);
  }

  @RequireRoles('SUPER_ADMIN', 'MODERATOR')
  @Post('incidents/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish a report that was held for review' })
  approveIncident(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Req() req: RivoRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.ops.approveIncident(id, this.context(req, admin, ip));
  }

  // --- Reels -----------------------------------------------------------------

  @RequireRoles('SUPER_ADMIN', 'MODERATOR', 'SUPPORT')
  @Get('reels')
  @ApiOperation({ summary: 'Property Reels' })
  listReels(@Query('status') status?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.ops.listReels({ status, page: Number(page) || 1, limit: Number(limit) || 25 });
  }

  @RequireRoles('SUPER_ADMIN', 'MODERATOR')
  @Post('reels/:id/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a reel — e.g. content that is not about the property' })
  removeReel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectionDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Req() req: RivoRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.ops.removeReel(id, this.context(req, admin, ip), dto.reason);
  }

  // --- Verification ----------------------------------------------------------

  @RequireRoles('SUPER_ADMIN', 'MODERATOR')
  @Get('verifications')
  @ApiOperation({ summary: 'Seller verification requests with signed document links' })
  listVerifications(@Query('status') status?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.ops.listVerifications({ status, page: Number(page) || 1, limit: Number(limit) || 25 });
  }

  @RequireRoles('SUPER_ADMIN', 'MODERATOR')
  @Post('verifications/:id/decide')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve or reject a verification request' })
  decideVerification(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerificationDecisionDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Req() req: RivoRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.ops.decideVerification(id, this.context(req, admin, ip), dto.decision, dto.reason);
  }

  // --- Reports ---------------------------------------------------------------

  @RequireRoles('SUPER_ADMIN', 'MODERATOR', 'SUPPORT')
  @Get('reports')
  @ApiOperation({ summary: 'Listing abuse reports' })
  listReports(@Query('status') status?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.ops.listReports({ status, page: Number(page) || 1, limit: Number(limit) || 25 });
  }

  @RequireRoles('SUPER_ADMIN', 'MODERATOR')
  @Post('reports/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close a report as actioned or dismissed' })
  resolveReport(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveReportDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Req() req: RivoRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.ops.resolveReport(id, this.context(req, admin, ip), dto.status, dto.note);
  }

  // --- Jobs ------------------------------------------------------------------

  @RequireRoles('SUPER_ADMIN', 'MODERATOR')
  @Get('jobs')
  @ApiOperation({ summary: 'Media and AI job state' })
  listJobs(
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ops.listJobs({ status, type, page: Number(page) || 1, limit: Number(limit) || 25 });
  }

  // --- Feature flags ---------------------------------------------------------

  @RequireRoles('SUPER_ADMIN')
  @Get('flags')
  @ApiOperation({
    summary: 'Feature flags',
    description: '`effective` is false when a flag is on but the credential its feature needs is missing.',
  })
  listFlags() {
    return this.ops.listFlags();
  }

  @RequireRoles('SUPER_ADMIN')
  @Patch('flags/:key')
  @ApiOperation({ summary: 'Turn a feature on or off' })
  setFlag(
    @Param('key') key: string,
    @Body() dto: SetFlagDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Req() req: RivoRequest,
    @ClientIp() ip: string | null,
  ) {
    return this.ops.setFlag(key, dto.enabled, this.context(req, admin, ip));
  }

  // --- Audit log -------------------------------------------------------------

  @RequireRoles('SUPER_ADMIN')
  @Get('audit-logs')
  @ApiOperation({
    summary: 'Search the audit trail',
    description: 'The table is append-only at the database level: UPDATE and DELETE are refused by a trigger.',
  })
  auditLogs(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('adminId') adminId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ops.listAuditLogs({
      entityType,
      entityId,
      adminId,
      action,
      from,
      to,
      page: Number(page) || 1,
      limit: Number(limit) || 50,
    });
  }

  // --- Admin accounts --------------------------------------------------------

  @RequireRoles('SUPER_ADMIN')
  @Get('admins')
  @ApiOperation({ summary: 'List admin accounts' })
  listAdmins() {
    return this.auth.listAdmins();
  }

  @RequireRoles('SUPER_ADMIN')
  @Post('admins')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an admin account with a temporary password' })
  createAdmin(
    @Body() dto: CreateAdminDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @ClientIp() ip: string | null,
  ) {
    return this.auth.createAdmin({
      actorId: admin.id,
      email: dto.email,
      displayName: dto.displayName,
      role: dto.role as AdminRole,
      temporaryPassword: dto.temporaryPassword,
      ip,
    });
  }

  @RequireRoles('SUPER_ADMIN')
  @Patch('admins/:id/active')
  @ApiOperation({ summary: 'Enable or disable an admin account' })
  setAdminActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetActiveDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @ClientIp() ip: string | null,
  ) {
    return this.auth.setActive(admin.id, id, dto.isActive, ip);
  }
}
