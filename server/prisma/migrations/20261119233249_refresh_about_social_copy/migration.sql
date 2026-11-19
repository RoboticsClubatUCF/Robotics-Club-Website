UPDATE "about_page"
SET "online_blurb" = $t$Find us on Instagram, Discord, GitHub, and YouTube.$t$,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'current'
  AND "online_blurb" = $t$Discord is where the club actually talks — meeting times, build threads and the lab sign all land there first.$t$;
