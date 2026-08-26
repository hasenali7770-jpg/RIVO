-- Records why an admin session ended (logout, password_changed, account_disabled),
-- matching the reason already tracked on user refresh sessions. Without it,
-- "why was I signed out?" cannot be answered from the data.
ALTER TABLE "admin_sessions" ADD COLUMN "revoked_reason" VARCHAR(64);
