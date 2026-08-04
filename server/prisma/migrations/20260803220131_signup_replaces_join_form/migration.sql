-- Joining the club becomes account signup, so the join form's inbox goes away:
-- a prospective member will create a User instead, landing at GUEST.
--
-- This drops the table and its rows. Nothing reads join_applications, and the
-- rows it holds are unstructured leads rather than club records, so they are
-- not worth migrating into users — a lead has no password and no consent to an
-- account. Export the table first if the current contents still matter.
DROP TABLE "join_applications";

-- Discord handle, not the numeric snowflake id. Unique because it names one
-- external account; nullable because most rows won't have one yet.
ALTER TABLE "users" ADD COLUMN "discord_username" TEXT;

CREATE UNIQUE INDEX "users_discord_username_key" ON "users"("discord_username");
