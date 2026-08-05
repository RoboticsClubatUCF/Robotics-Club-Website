-- Renames the sponsorship levels from the metal ladder to the club's own names,
-- and folds the fifth level into the lowest.
--
-- Written by hand rather than generated. Prisma diffs only the *set* of enum
-- values, so it cannot see that PLATINUM and PROCESSOR_PATRON are the same rank
-- under a new name — it would drop the type and take every sponsor's tier with
-- it. The swap below preserves each row, and the CREATE TYPE order is the
-- ranking itself: Postgres sorts an enum by declaration order and
-- `GET /api/sponsors` orders on tier, which is what makes "the top five" the
-- first five rows.

CREATE TYPE "SponsorTier_new" AS ENUM (
  'PROCESSOR_PATRON',
  'CIRCUIT_SUPPORTER',
  'BOLT_BACKER',
  'ALUMINUM_ALLY'
);

-- The default is written in the old type's terms, so it has to go before the
-- column can change type and come back afterwards.
ALTER TABLE "sponsors" ALTER COLUMN "tier" DROP DEFAULT;

-- PARTNER has no counterpart in the new ladder — it was the level below BRONZE
-- rather than a rank of its own — so it lands on the lowest one. There is no
-- way back from that in a down migration; the distinction is gone.
ALTER TABLE "sponsors"
  ALTER COLUMN "tier" TYPE "SponsorTier_new"
  USING (
    CASE "tier"::text
      WHEN 'PLATINUM' THEN 'PROCESSOR_PATRON'
      WHEN 'GOLD'     THEN 'CIRCUIT_SUPPORTER'
      WHEN 'SILVER'   THEN 'BOLT_BACKER'
      WHEN 'BRONZE'   THEN 'ALUMINUM_ALLY'
      WHEN 'PARTNER'  THEN 'ALUMINUM_ALLY'
    END
  )::"SponsorTier_new";

DROP TYPE "SponsorTier";
ALTER TYPE "SponsorTier_new" RENAME TO "SponsorTier";

ALTER TABLE "sponsors" ALTER COLUMN "tier" SET DEFAULT 'ALUMINUM_ALLY';
