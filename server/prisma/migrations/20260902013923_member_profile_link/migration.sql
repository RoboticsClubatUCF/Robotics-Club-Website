-- Where a member's photograph points: their own LinkedIn, GitHub or the like.
-- Nullable, and null is the state every existing row starts in and most stay in.
ALTER TABLE "users" ADD COLUMN "profile_url" TEXT;
