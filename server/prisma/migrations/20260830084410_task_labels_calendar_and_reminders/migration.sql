-- Tasks grow three labels, a calendar opt-in and a reminder claim.
--
-- Written by hand rather than taken from `migrate diff` as it came, for the two
-- reasons that flow has always needed watching here:
--
--   * **Prisma ignores enum ordering.** It diffs only the *set* of values, so it
--     emitted three bare `ADD VALUE`s that append to the end of the type — which
--     would sort DONE *above* IN_PROGRESS, DELAYED and CANCELED for ever, since
--     Postgres sorts an enum by declaration order and the task board orders by
--     `status: 'asc'`. The positional forms below are what put settled work at
--     the bottom of the list where the schema says it goes.
--   * It also wanted `ALTER TABLE "projects" ALTER COLUMN "meeting_weekdays"
--     DROP DEFAULT`, which is unrelated drift left by 20260824220000 and not
--     this migration's business — the same line 20260825224248, 20260826230843,
--     20260829220652 and 20260829224954 each had to strip.
--
-- `ADD VALUE` is not wrapped in a transaction with anything that uses the new
-- values, and Prisma does not wrap a migration in one, so all three land before
-- the DDL below runs. Nothing here backfills, so the statement order is free.

-- AlterEnum: three labels, each placed rather than appended.
ALTER TYPE "TaskStatus" ADD VALUE 'IN_PROGRESS' AFTER 'OPEN';
ALTER TYPE "TaskStatus" ADD VALUE 'DELAYED' BEFORE 'DONE';
ALTER TYPE "TaskStatus" ADD VALUE 'CANCELED' AFTER 'DONE';

-- AlterTable: a task may now belong to a person rather than to a project, and
-- carries the deadline its overdue DM already named.
ALTER TABLE "tasks" ADD COLUMN     "reminded_for" TIMESTAMP(3),
ALTER COLUMN "project_id" DROP NOT NULL;

-- AlterTable: the per-assignee calendar opt-in. Default false — a lead assigning
-- work is not the same act as somebody putting it in their own week.
ALTER TABLE "task_assignees" ADD COLUMN     "on_calendar" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex: the reminder sweep's window. Neither existing index on `tasks`
-- serves it; both lead with a column the sweep does not filter on.
CREATE INDEX "tasks_status_due_at_idx" ON "tasks"("status", "due_at");
