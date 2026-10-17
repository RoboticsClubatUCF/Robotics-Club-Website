-- Keep every existing project member visible. Only memberships created after
-- this migration need a lead or officer to grant public listing.
ALTER TABLE "project_members" ADD COLUMN "publicly_listed" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "project_members" ALTER COLUMN "publicly_listed" SET DEFAULT false;
