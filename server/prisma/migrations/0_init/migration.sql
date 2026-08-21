-- Baseline: the whole schema at the squash, not a step in a history.
--
-- The 26 migrations this replaces are archaeology. They built a `members` table
-- and folded it into `users` the same day, created `membership_activations` and
-- dropped it 25 minutes later, and cut `UserRole` from eight values to four —
-- roughly a third of that SQL was data migration that could never move a row
-- again, because the only databases that ever existed were development boxes
-- already at head. Squashed before the club had a production database, which is
-- the last moment it is free. They are still in git history if the reasoning is
-- ever wanted: `git log --diff-filter=D -- server/prisma/migrations`.
--
-- A database made before this file is marked up to date with
--   prisma migrate resolve --applied 0_init
-- which writes the bookkeeping row without running any of the SQL. A fresh one
-- gets it from `prisma migrate deploy` like any other migration.
--
-- Everything from here down is generated. Regenerating it is
--   prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script
-- and the enum declaration order it emits is load-bearing — see database.md.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OFFICER', 'MEMBER', 'GUEST');

-- CreateEnum
CREATE TYPE "OfficerPosition" AS ENUM ('PRESIDENT', 'VICE_PRESIDENT', 'TREASURER', 'SECRETARY', 'MARKETING', 'OUTREACH', 'LAB_MANAGER', 'FACULTY_ADVISOR');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('CONCEPT', 'IN_PROGRESS', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProjectMemberRank" AS ENUM ('PROJECT_LEAD', 'TEAM_LEAD', 'MEMBER');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('MEETING', 'COMPETITION', 'OUTREACH', 'WORKSHOP', 'FUNDRAISER', 'SOCIAL');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('IMAGE', 'PRINT_MODEL');

-- CreateEnum
CREATE TYPE "PrintRequestStatus" AS ENUM ('PENDING', 'PRINTING', 'DONE', 'REJECTED');

-- CreateEnum
CREATE TYPE "PrintProcess" AS ENUM ('FDM', 'SLA');

-- CreateEnum
CREATE TYPE "PrintMaterial" AS ENUM ('PLA', 'PETG', 'ABS_LIKE_RESIN');

-- CreateEnum
CREATE TYPE "InfillPattern" AS ENUM ('GRID', 'GYROID', 'LINES', 'TRIANGLES', 'CUBIC', 'HONEYCOMB', 'CONCENTRIC');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('REQUESTED', 'APPROVED', 'CHECKED_OUT', 'RETURNED', 'DENIED', 'CANCELED');

-- CreateEnum
CREATE TYPE "SponsorTier" AS ENUM ('PROCESSOR_PATRON', 'CIRCUIT_SUPPORTER', 'BOLT_BACKER', 'ALUMINUM_ALLY');

-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('NEW', 'READ', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Season" AS ENUM ('SPRING', 'SUMMER', 'FALL');

-- CreateEnum
CREATE TYPE "DuesPlan" AS ENUM ('SEMESTER', 'YEAR');

-- CreateEnum
CREATE TYPE "DuesPaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "slug" TEXT,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "discord_username" TEXT,
    "discord_id" TEXT,
    "password_hash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'GUEST',
    "title" TEXT,
    "officer_position" "OfficerPosition",
    "grad_year" INTEGER,
    "bio" TEXT,
    "photo_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "joined_at" TIMESTAMP(3),
    "acknowledgement_accepted_at" TIMESTAMP(3),
    "dues_paid_through" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "subteam_id" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subteams" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "subteams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "description" TEXT,
    "season" TEXT,
    "competition" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "cover_url" TEXT,
    "repo_url" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "meeting_weekday" INTEGER,
    "meeting_time" TEXT,
    "meeting_location" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT,
    "rank" "ProjectMemberRank" NOT NULL DEFAULT 'MEMBER',
    "team_id" TEXT,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("project_id","user_id")
);

-- CreateTable
CREATE TABLE "project_images" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "focal_x" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "focal_y" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "zoom" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_links" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "team_id" TEXT,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "due_at" TIMESTAMP(3),
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "created_by_id" TEXT,
    "completed_by_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_assignees" (
    "task_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("task_id","user_id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "EventType" NOT NULL DEFAULT 'MEETING',
    "location" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "registration_url" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "project_id" TEXT,
    "team_id" TEXT,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stored_files" (
    "id" TEXT NOT NULL,
    "kind" "FileKind" NOT NULL,
    "mime_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "original_name" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "file_id" TEXT,
    "file_name" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "process" "PrintProcess" NOT NULL DEFAULT 'FDM',
    "material" "PrintMaterial" NOT NULL DEFAULT 'PLA',
    "infill_pattern" "InfillPattern",
    "infill_density" INTEGER,
    "project_id" TEXT,
    "grams_used" INTEGER,
    "printed_process" "PrintProcess",
    "printed_material" "PrintMaterial",
    "printed_infill_pattern" "InfillPattern",
    "printed_infill_density" INTEGER,
    "term_year" INTEGER NOT NULL,
    "term_season" "Season" NOT NULL,
    "status" "PrintRequestStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "officer_note" TEXT,
    "decided_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "print_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "max_loan_days" INTEGER NOT NULL DEFAULT 7,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_loans" (
    "id" TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'REQUESTED',
    "note" TEXT,
    "officer_note" TEXT,
    "due_at" TIMESTAMP(3),
    "start_at" TIMESTAMP(3),
    "requested_due_at" TIMESTAMP(3),
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "checked_out_at" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),
    "reminded_for" TIMESTAMP(3),
    "decided_by_id" TEXT,

    CONSTRAINT "equipment_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "body" TEXT NOT NULL,
    "cover_url" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "author_id" TEXT,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" "SponsorTier" NOT NULL DEFAULT 'ALUMINUM_ALLY',
    "logo_url" TEXT,
    "website_url" TEXT,
    "blurb" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sponsors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_messages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "status" "InquiryStatus" NOT NULL DEFAULT 'NEW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signup_verifications" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dues_payments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan" "DuesPlan" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" "DuesPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "stripe_payment_intent_id" TEXT NOT NULL,
    "term_year" INTEGER NOT NULL,
    "term_season" "Season" NOT NULL,
    "covers_through" TIMESTAMP(3) NOT NULL,
    "receipt_url" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dues_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_notices" (
    "user_id" TEXT NOT NULL,
    "term_year" INTEGER NOT NULL,
    "term_season" "Season" NOT NULL,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),
    "failure" TEXT,

    CONSTRAINT "trial_notices_pkey" PRIMARY KEY ("user_id","term_year","term_season")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_slug_key" ON "users"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_discord_username_key" ON "users"("discord_username");

-- CreateIndex
CREATE UNIQUE INDEX "users_discord_id_key" ON "users"("discord_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_officer_position_key" ON "users"("officer_position");

-- CreateIndex
CREATE INDEX "users_subteam_id_idx" ON "users"("subteam_id");

-- CreateIndex
CREATE INDEX "users_active_idx" ON "users"("active");

-- CreateIndex
CREATE INDEX "users_active_role_full_name_idx" ON "users"("active", "role", "full_name");

-- CreateIndex
CREATE INDEX "users_dues_paid_through_idx" ON "users"("dues_paid_through");

-- CreateIndex
CREATE UNIQUE INDEX "subteams_slug_key" ON "subteams"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");

-- CreateIndex
CREATE INDEX "projects_status_idx" ON "projects"("status");

-- CreateIndex
CREATE INDEX "projects_featured_idx" ON "projects"("featured");

-- CreateIndex
CREATE INDEX "projects_featured_started_at_idx" ON "projects"("featured", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "teams_project_id_name_key" ON "teams"("project_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "teams_id_project_id_key" ON "teams"("id", "project_id");

-- CreateIndex
CREATE INDEX "project_members_user_id_idx" ON "project_members"("user_id");

-- CreateIndex
CREATE INDEX "project_members_team_id_idx" ON "project_members"("team_id");

-- CreateIndex
CREATE INDEX "project_images_project_id_sort_order_idx" ON "project_images"("project_id", "sort_order");

-- CreateIndex
CREATE INDEX "project_links_project_id_sort_order_idx" ON "project_links"("project_id", "sort_order");

-- CreateIndex
CREATE INDEX "tasks_project_id_status_idx" ON "tasks"("project_id", "status");

-- CreateIndex
CREATE INDEX "tasks_team_id_status_idx" ON "tasks"("team_id", "status");

-- CreateIndex
CREATE INDEX "task_assignees_user_id_idx" ON "task_assignees"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");

-- CreateIndex
CREATE INDEX "events_starts_at_idx" ON "events"("starts_at");

-- CreateIndex
CREATE INDEX "events_published_starts_at_idx" ON "events"("published", "starts_at");

-- CreateIndex
CREATE INDEX "events_published_ends_at_idx" ON "events"("published", "ends_at");

-- CreateIndex
CREATE INDEX "events_project_id_starts_at_idx" ON "events"("project_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "print_requests_file_id_key" ON "print_requests"("file_id");

-- CreateIndex
CREATE INDEX "print_requests_status_created_at_idx" ON "print_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "print_requests_user_id_created_at_idx" ON "print_requests"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "print_requests_user_id_term_year_term_season_idx" ON "print_requests"("user_id", "term_year", "term_season");

-- CreateIndex
CREATE INDEX "print_requests_project_id_idx" ON "print_requests"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_name_key" ON "equipment"("name");

-- CreateIndex
CREATE INDEX "equipment_active_name_idx" ON "equipment"("active", "name");

-- CreateIndex
CREATE INDEX "equipment_loans_equipment_id_status_idx" ON "equipment_loans"("equipment_id", "status");

-- CreateIndex
CREATE INDEX "equipment_loans_user_id_status_idx" ON "equipment_loans"("user_id", "status");

-- CreateIndex
CREATE INDEX "equipment_loans_status_requested_at_idx" ON "equipment_loans"("status", "requested_at");

-- CreateIndex
CREATE INDEX "equipment_loans_status_due_at_idx" ON "equipment_loans"("status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "posts_slug_key" ON "posts"("slug");

-- CreateIndex
CREATE INDEX "posts_published_at_idx" ON "posts"("published_at");

-- CreateIndex
CREATE INDEX "posts_author_id_idx" ON "posts"("author_id");

-- CreateIndex
CREATE UNIQUE INDEX "sponsors_name_key" ON "sponsors"("name");

-- CreateIndex
CREATE INDEX "sponsors_tier_idx" ON "sponsors"("tier");

-- CreateIndex
CREATE INDEX "sponsors_active_tier_idx" ON "sponsors"("active", "tier");

-- CreateIndex
CREATE INDEX "contact_messages_status_created_at_idx" ON "contact_messages"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "signup_verifications_email_key" ON "signup_verifications"("email");

-- CreateIndex
CREATE UNIQUE INDEX "signup_verifications_token_hash_key" ON "signup_verifications"("token_hash");

-- CreateIndex
CREATE INDEX "signup_verifications_expires_at_idx" ON "signup_verifications"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "dues_payments_stripe_payment_intent_id_key" ON "dues_payments"("stripe_payment_intent_id");

-- CreateIndex
CREATE INDEX "dues_payments_user_id_created_at_idx" ON "dues_payments"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "dues_payments_status_idx" ON "dues_payments"("status");

-- CreateIndex
CREATE INDEX "trial_notices_term_year_term_season_idx" ON "trial_notices"("term_year", "term_season");

-- CreateIndex
CREATE INDEX "rate_limits_expires_at_idx" ON "rate_limits"("expires_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_subteam_id_fkey" FOREIGN KEY ("subteam_id") REFERENCES "subteams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_team_id_project_id_fkey" FOREIGN KEY ("team_id", "project_id") REFERENCES "teams"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_images" ADD CONSTRAINT "project_images_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_requests" ADD CONSTRAINT "print_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_requests" ADD CONSTRAINT "print_requests_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_requests" ADD CONSTRAINT "print_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_requests" ADD CONSTRAINT "print_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_loans" ADD CONSTRAINT "equipment_loans_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_loans" ADD CONSTRAINT "equipment_loans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_loans" ADD CONSTRAINT "equipment_loans_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dues_payments" ADD CONSTRAINT "dues_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_notices" ADD CONSTRAINT "trial_notices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
