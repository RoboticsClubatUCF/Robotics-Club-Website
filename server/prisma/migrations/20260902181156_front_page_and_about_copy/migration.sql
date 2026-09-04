-- CreateTable
CREATE TABLE "front_page" (
    "id" TEXT NOT NULL DEFAULT 'current',
    "headline" TEXT NOT NULL,
    "headline_accent" TEXT NOT NULL,
    "lede" TEXT NOT NULL,
    "partners_intro" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "front_page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faqs" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "steps" TEXT[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_programs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "blurb" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "link_label" TEXT NOT NULL,
    "image_url" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "about_page" (
    "id" TEXT NOT NULL DEFAULT 'current',
    "heading" TEXT NOT NULL,
    "lede" TEXT NOT NULL,
    "story_notice" TEXT,
    "story" TEXT[],
    "lab_building" TEXT,
    "lab_street" TEXT,
    "lab_city" TEXT,
    "lab_map_url" TEXT,
    "online_blurb" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "about_page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "about_milestones" (
    "id" TEXT NOT NULL,
    "when_label" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "about_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "faqs_sort_order_idx" ON "faqs"("sort_order");

-- CreateIndex
CREATE INDEX "partner_programs_sort_order_idx" ON "partner_programs"("sort_order");

-- CreateIndex
CREATE INDEX "about_milestones_sort_order_idx" ON "about_milestones"("sort_order");

-- The copy that was in the bundle, moved into the tables above.
--
-- A data migration rather than a seed, and it has to be: the seed refuses to run
-- outside development, so on the club's live database these tables would be
-- empty the moment the deploy finished — no FAQ on the front page, no timeline
-- on the about page, and nothing to say why. This is the same content the
-- components were printing before, written once, here, where it arrives with the
-- tables that hold it.
--
-- Dollar-quoted because the club's own words are full of apostrophes and one
-- escaped quote missed is a migration that fails half way through against real
-- data. `gen_random_uuid()` rather than a uuid v7: the column is TEXT, the v7
-- default is Prisma's, and nothing here reads an id for its timestamp.
--
-- `ON CONFLICT DO NOTHING` on the two singletons only. The lists cannot conflict
-- — their tables are created three statements above this one — and a re-run is
-- not a thing that happens to a migration, but the singletons are keyed by a
-- value a person could plausibly have inserted by hand while testing.

INSERT INTO "front_page" ("id", "headline", "headline_accent", "lede", "partners_intro", "updated_at")
VALUES (
  'current',
  $t$Building Our Future,$t$,
  $t$One Robot at a Time.$t$,
  $t$Ready to dive into hands-on engineering? Whether you are a master at CAD, an experienced coder, or just eager to learn how to build complex systems from the ground up, there's a place for you on our team. Get involved and start building with us today.$t$,
  $t$Club membership is UCF students only. These programs we work with are open to everybody else.$t$,
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "faqs" ("id", "question", "answer", "steps", "sort_order", "created_at") VALUES
(gen_random_uuid(), $t$Do I need experience to join?$t$, $t$No, all projects are drop-in certified, so no skills or experience are required for you to join a project! It is, however, required that you become a member before participating in any projects.$t$, ARRAY[]::TEXT[], 0, CURRENT_TIMESTAMP),
(gen_random_uuid(), $t$How much is membership?$t$, $t$Membership is $25 a semester and $50 a year. There will be times in which the lab is open during the summer and during those times membership is completely free!$t$, ARRAY[]::TEXT[], 1, CURRENT_TIMESTAMP),
(gen_random_uuid(), $t$How do I become a member?$t$, $t$Becoming a member is as easy as:$t$, ARRAY[
  $t$Create an RCCF web account with the "Join the club" button up top$t$,
  $t$Fill in the member survey — two minutes, and you are only asked once$t$,
  $t$Pay your dues$t$,
  $t$Join a general body meeting (times posted on Discord)$t$
], 2, CURRENT_TIMESTAMP),
(gen_random_uuid(), $t$Can I create my own project?$t$, $t$It depends, the approval or denial of a project depends on the number of people interested, the allowed budget, and general approval from administration. If you truly want to start your own project within RCCF start by talking to Crystal or the president.$t$, ARRAY[]::TEXT[], 3, CURRENT_TIMESTAMP),
(gen_random_uuid(), $t$Can I pay for something to be 3D printed?$t$, $t$Yes! Price will vary depending on the size and in-fill of the print. Other than that just make sure you ask early on as we have a lot of projects that require 3D printing and those come first.$t$, ARRAY[]::TEXT[], 4, CURRENT_TIMESTAMP),
(gen_random_uuid(), $t$Where is the lab located?$t$, $t$We are located in UCF's Institute For Simulation & Training at 3100 Technology Pkwy, Orlando, FL 32826.$t$, ARRAY[]::TEXT[], 5, CURRENT_TIMESTAMP),
(gen_random_uuid(), $t$How do I join a project?$t$, $t$Joining a project is easy. Once you've become a member and paid your dues head over to the discord and in bot-cmds type in /teams to pull up all the projects and then all you have to do is pick the ones you want to join. Of course, show up to the meetings as well.$t$, ARRAY[]::TEXT[], 6, CURRENT_TIMESTAMP),
(gen_random_uuid(), $t$How do sponsorships work?$t$, $t$If you would like to sponsor us check out what we offer in our sponsors' page, otherwise it's basically a way to financially support RCCF and its mission.$t$, ARRAY[]::TEXT[], 7, CURRENT_TIMESTAMP);

-- The names and the two official sites are real; the audience lines and the
-- blurbs are placeholders and say so in their own text, which is the point of
-- writing them in rather than leaving the section empty.
INSERT INTO "partner_programs" ("id", "name", "audience", "blurb", "href", "link_label", "image_url", "sort_order", "created_at") VALUES
(gen_random_uuid(), $t$VEX Robotics$t$, $t$PLACEHOLDER — WHO IT IS FOR$t$, $t$Placeholder. What RCCF does with VEX, who the program takes, and what somebody outside UCF actually turns up to. Two or three sentences is the size this card is built around.$t$, $t$https://www.vexrobotics.com/$t$, $t$Visit VEX Robotics$t$, NULL, 0, CURRENT_TIMESTAMP),
(gen_random_uuid(), $t$FIRST Robotics$t$, $t$PLACEHOLDER — WHO IT IS FOR$t$, $t$Placeholder. The same again for FIRST — the club's involvement, the teams it reaches, and how to get in touch with the people running it locally.$t$, $t$https://www.firstinspires.org/$t$, $t$Visit FIRST$t$, NULL, 1, CURRENT_TIMESTAMP);

INSERT INTO "about_page" ("id", "heading", "lede", "story_notice", "story", "lab_building", "lab_street", "lab_city", "lab_map_url", "online_blurb", "updated_at")
VALUES (
  'current',
  $t$Building robots at UCF since 1972.$t$,
  $t$The Robotics Club of Central Florida is a student organisation at UCF. Members design, build and compete with robots — and, more of the time than anybody admits, take apart the ones that stopped working. No experience is needed to join a project, and none of the people running it started with any.$t$,
  $t$The history below is placeholder text. The club is genuinely from 1972; the rest is waiting on somebody who was there to write it.$t$,
  ARRAY[
    $t$Placeholder. What the club was founded to do in 1972, who founded it, and what has survived from then to now. Somebody who was there should write this paragraph.$t$,
    $t$Placeholder. What the club looks like on an ordinary Tuesday: how many people are in the lab, what they are working on, and how a project gets from an idea to a machine that moves.$t$,
    $t$Placeholder. What the club is for beyond the robots — the members who learned to weld here, the ones who got hired off a competition, and the schools the outreach team visits.$t$
  ],
  $t$UCF Institute for Simulation & Training$t$,
  $t$3100 Technology Pkwy$t$,
  $t$Orlando, FL 32826$t$,
  $t$https://www.google.com/maps/search/?api=1&query=UCF+Institute+for+Simulation+and+Training%2C+3100+Technology+Pkwy%2C+Orlando%2C+FL+32826$t$,
  $t$Discord is where the club actually talks — meeting times, build threads and the lab sign all land there first.$t$,
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

-- Only the first is real. The rest spell PLACEHOLDER in the column the page
-- prints in gold, so an unfinished timeline is obvious rather than plausible.
INSERT INTO "about_milestones" ("id", "when_label", "what", "sort_order", "created_at") VALUES
(gen_random_uuid(), $t$1972$t$, $t$The club is founded at what was then Florida Technological University.$t$, 0, CURRENT_TIMESTAMP),
(gen_random_uuid(), $t$PLACEHOLDER$t$, $t$Placeholder — the first competition the club entered, and how it went.$t$, 1, CURRENT_TIMESTAMP),
(gen_random_uuid(), $t$PLACEHOLDER$t$, $t$Placeholder — when the club moved into the lab it works out of today.$t$, 2, CURRENT_TIMESTAMP),
(gen_random_uuid(), $t$PLACEHOLDER$t$, $t$Placeholder — a result, a build or a year worth naming.$t$, 3, CURRENT_TIMESTAMP),
(gen_random_uuid(), $t$PLACEHOLDER$t$, $t$Placeholder — the most recent thing worth putting on this list.$t$, 4, CURRENT_TIMESTAMP);
