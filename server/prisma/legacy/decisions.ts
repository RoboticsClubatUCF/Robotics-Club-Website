import { OfficerPosition } from '../../src/generated/prisma/enums.js'
import { type Decisions, NO_TERM } from './plan.js'

/**
 * The answers to the special cases the import refuses to guess at.
 *
 * Every entry is a decision about a real person's account, so every entry says
 * who it is about and why. `import-legacy.ts` will not write while a blocking
 * case is missing from here — run it with no arguments to see what is left.
 *
 * The ids are the old database's `Member.id`. They are unreadable on purpose:
 * an email address is what somebody changes, and this file has to still mean
 * the same thing after they do.
 */
export const DECISIONS: Decisions = {
  /**
   * Accounts that do not come across.
   *
   * Thirteen are signup spam: an address of random letters on a
   * disposable-mail domain, a display name that matches neither, no survey and
   * no dues. Four are the club's own test accounts, one of which
   * (`nah@nah.com`) filled the survey in with "old account no touchy pls delete
   * me ty", and one of which is the shared `officers@rccf.club` address used to
   * test the form — its survey answers are "your mom" and "help meeeee".
   */
  drop: [
    '1ec187cd-fa0a-4434-a5dc-667f976ac57e', // "Alessandra" <TNJldy.hqwqqdc@rushlight.cfd> @Brayden Vincent
    'b32e9e55-5186-4923-bbd6-89d8f1cf2f6a', // "Zendaya" <DSKrrP.bbqpctc@sandcress.xyz> @Weston Farley
    'e0eb55a3-7424-48ef-a575-84487eb45ed7', // "Emelia" <uCRtQJ.bcbppcm@spectrail.world> @Ayla Perkins
    '235ecaaf-ce6d-490c-9b61-d8c965d935b9', // "Axl" <yPLLaY.dcptccd@rushlight.cfd> @Reuben Acevedo
    '6f324be3-26ab-4eb5-91f9-ce10fc70337c', // "Brock" <uKOOMp.qwtjcjj@tonetics.biz> @Alec Singh
    '57765a32-1d47-4934-a645-979daa4e9b45', // "Shiloh" <oPrFjb.hqtqdbd@sabletree.foundation> @Wyatt Terrell
    '068fa8fc-024a-4b0c-89ee-2c8d046b30b3', // "Raelynn" <ObXOaC.tjcbthw@chilgoza.buzz> @Edison Castro
    'a5ad74a8-0e80-4e82-af0c-0422de9558db', // "bryttanie" <wtchwtbpm.q@monochord.xyz>
    '9c9f6a61-5b65-4f26-b294-3862f19a2e2a', // "Edwin" <SmXfqd.ttwpcjd@rushlight.cfd> @Dustin Livingston
    'c5a8ba8a-4984-455e-9d5a-dec66909d2d9', // "tristiana" <btmhqbchq.q@monochord.xyz>
    '5c11212d-ea98-433e-89a2-d65b84a06eb4', // "Mira" <UjXRWm.mhjpdt@sandcress.xyz> @Kartier Gilbert
    '834eab68-1616-4b4c-8e79-a746c6d44df7', // "Hfksjc Djcjeb" <testing@admin.org> — a test signup
    'b1157684-4e2c-4d3a-b91c-59ef9d98f0fb', // "te22 test01" <test01@email.com> @tester01
    '755a58f1-1159-48e7-87aa-d223f8d93f42', // "nah nah" <nah@nah.com> — survey says "delete me ty"
    '078876dd-4d77-49eb-9677-ca037544cf6c', // <officers@rccf.club> — the club's own address, used to test the form
    'ce2d1354-1044-4528-adad-8907745ffabb', // "Tester0 2" <fu@ucf.edu> @rccfbot — no password
    'e63ed165-343b-42ff-a78d-ef57f8bfceb4', // "test" — no email, no handle, no password
  ],

  /**
   * Flagged by the domain check, looked at, and real.
   *
   * Five are typing mistakes nobody ever noticed — `gmail.con`, `gmail.comi`,
   * `gamil.com` — and they are **left exactly as typed**. That address is the
   * one on the account and therefore the one that signs in; correcting it would
   * hand somebody a working mailbox and take away their login on the same day.
   * The rest are people who signed up with a work address rather than a
   * student one, and all but two answered the survey.
   */
  keep: [
    '78de88a4-24cf-421a-ab6b-99b00813dc3f', // Jeffrey Donovan <jeff.donovan@kdfrobotics.com>
    '32b64da8-b529-425b-95ce-fda93e98f8e7', // Pedro <padisla1579@gmail.con> — typo for gmail.com
    'c3bb50d4-136d-4ab0-9b47-8b6133e88a00', // Hope Wood <hcwood01@gmail.comi> — typo, survey 187
    '39f88a9b-795f-4cc2-9620-fba57ad345a2', // Brendan Marcellus <…@gamil.com> — typo, survey 151
    '57f09d88-0b93-417c-8480-5202e840a20b', // anade davis <Investors@smarthomefund.com> — survey 214
    '47efb773-e4cf-4c32-abed-c7b52d87ac86', // Jackson Davis <jackson@the-davis-family.com> — survey 339
    'b0ff187c-61c6-4684-ba46-1087ee8308ef', // Aaron Botwinik <aaron@botwinik.net> — survey 455
    '6ff12dd8-498e-4751-a148-25767fedbc3e', // shiv saggu <ssaggu@deloitte.com> — survey 309
    '0f1b72a5-a8b3-4c55-ba7c-9782d41a5e6b', // Yarah Bennani <Sanae_yazghi@hotmail.fr>
  ],

  /**
   * Fourteen people with two accounts each — a personal address and then a
   * `@ucf.edu` one, or the same handle typed with a different capital. The old
   * database allowed both because its unique index was case-sensitive; `email`
   * and `discord_username` here are not, so one row of each pair has to go.
   *
   * The one that is kept is the one that answered the survey; where both did or
   * neither did, the one with the later dues date. `mergeUsers` then takes the
   * truest value of every field from *both* rows — the later dues, the earlier
   * join date, whichever password and handle exist — so nothing is lost by the
   * choice of which row is nominally the survivor.
   */
  mergeInto: {
    // Amy — both accounts guests, neither surveyed; the `@ucf.edu` one paid later.
    'b823a88d-b936-4a86-8b56-e1683f7f82d6': '390fdc3c-6fc7-47de-a656-7dd81359bae1',
    // Rashida White — two signups a minute and a half apart.
    'af782572-8213-4517-83da-3e34253a3610': 'ee8b8b48-0581-4fe7-b568-7b073a195775',
    // Kelly Breen — the `@ucf.edu` row has the survey and the dues.
    'f51c252b-1035-4613-8e89-b8d2fef23286': '7646bee4-8444-475c-8d3b-797ee485deb4',
    // Patrick Keeney — both surveyed. The named row is kept and the other's
    // later dues date comes with it; keeping the nameless one would have put a
    // blank on the roster.
    'c5937db6-9088-4bf3-a0b3-550ade261cf0': '0b884ee9-11b5-41b2-81ab-44241fa32653',
    // Samantha Graham.
    'a874984d-64c2-4551-98f6-4ccc9663db02': '0c2cffdf-dcd8-4d10-b4dc-ef1cd034f1d1',
    // Tevin Mukudi — the `@rccf.club` row has the survey.
    '3f0aa14f-0b24-48ea-9ab1-843d15b65dd6': 'ccae59f0-b5d2-4b97-8b52-5e09ceaaaa72',
    // Rachel Singh.
    '0ad2b430-bfe1-429c-a5b0-6505d209aa29': '9389f01d-a5bf-4f14-aac1-241c6b318f0b',
    // Valeria Chilbery — two signups 35 seconds apart, the second with `|`
    // typed into the handle field. The usable handle survives the merge.
    'b66f4786-98ef-41a8-a05a-f5453484ea37': '152777d7-8ff0-4475-a249-f240d3c64a2a',
    // Caeden Dooner.
    '4dbc4746-6a22-4ff9-8ec0-1682e6a3ee9d': '5c095ab4-427f-42e5-a788-6b77cef346aa',
    // Matilyn Andrade — one row is a `member`, the other a `guest`; the higher
    // standing of the two wins, which is what `mergeUsers` does with roles.
    '758c3eeb-d91d-4b00-a4fc-09924d387307': 'a2b29ea4-f038-4d00-a2f5-3ffab3cdf0ff',
    // Yaniel Petrovich — both surveyed, both members; later dues wins.
    'e7294ee8-d616-4aea-9e25-6d0dd73a4c96': '00161e94-0cfa-468c-8290-4918d7cc3472',
    // Noah Dominguez-vega.
    'ce23c225-c9b2-4e1f-885d-713d30ad88bf': '3c66c194-f683-472b-b12e-779ff31d8f29',
    // Brandon Stile — the second account is the first with `gmail.con` typed
    // for `gmail.com`. Same person, same dues date, three minutes apart.
    'd295987b-44e1-4933-a332-17ca7d9ff0fa': 'b164bcb5-c87c-4de6-9382-10cd362b95be',
  },

  /**
   * Discord handles that cannot be imported as they stand.
   *
   * Thirty-four rows hold something that is not a handle: a display name with
   * spaces, an email address, a legacy `name#1234`, or `|`. All of them import
   * as no handle at all, which is the default and needs no entry here — the
   * cost is one Discord notification they will not receive, and the dues page
   * says the same thing.
   *
   * A `#1234` could be stripped to the part before it, and that is exactly why
   * it is not: `angle#2784` and `Jarvis#6431` were somebody's handle *in 2023*,
   * before Discord retired discriminators, and there is no reason to think
   * `angle` or `Jarvis` belongs to the same person today. Handing one member's
   * notifications to a stranger is worse than sending none.
   */
  handles: {},

  /**
   * The nine people with a `position` on the old site.
   *
   * Seven map straight onto a seat. Two do not, and both are the reason
   * `OfficerPosition` and `UserRole` are separate enums:
   *
   * - **Crystal Maraj** is the faculty advisor, who sits on the board without
   *   officer permissions. `MEMBER` plus a `FACULTY_ADVISOR` term, which is the
   *   case the schema comment on `OfficerPosition` is written about.
   * - **Dwight Howard, II** held "The Robot Man", which is not an office. He
   *   keeps `ADMIN` and the title on his profile, and gets no term: the board
   *   is eight chairs and he was not in one.
   */
  seats: {
    'e12f27a7-4ebf-4211-89cd-78ed1cf1c238': OfficerPosition.PRESIDENT, // Gavin Fitzgerald
    '093db84f-dc28-4b4e-b522-1f1a8eb29640': OfficerPosition.VICE_PRESIDENT, // Stephen Chapman
    'd293d7ff-5391-4e88-ba8a-309b241427a9': OfficerPosition.TREASURER, // Maurice Elkhoury
    'e3474c8a-59c4-4729-805d-34cd22ab9341': OfficerPosition.SECRETARY, // Aiden Fowler
    'a1f1e283-b4c2-41b0-add4-91aaab28a47c': OfficerPosition.MARKETING, // Lily Rieckhoff
    '0aba1e72-f7f2-4e01-b9e6-025d5ca0a8dc': OfficerPosition.OUTREACH, // Zahid Padilla
    'a407aa2f-c791-4319-baff-618a6f202a9c': OfficerPosition.LAB_MANAGER, // Caicheng Li
    '908c56f9-a1fa-4b2f-b989-f93b69b05d92': OfficerPosition.FACULTY_ADVISOR, // Crystal Maraj
    '31e5f649-fe61-49e7-8d7c-efda5708ffaf': NO_TERM, // Dwight Howard, II — "The Robot Man"
  },

  overrides: {
    /**
     * Crystal Maraj, the faculty advisor.
     *
     * Her old `membershipExpDate` reads **3026**, which is a typo for 2026 —
     * and correcting it to 2026 would lock her out of the site tomorrow, since
     * `requireCurrentDues` reads that column and nothing else. A far-future
     * date is what `trialNotice.ts` says the advisor should have and for
     * exactly this reason, so the typo is kept as an intention and tidied to a
     * year that does not read as corrupt data in every export.
     *
     * `MEMBER`, not `ADMIN`: the old site gave her the top permission level
     * because it had no way to say "on the board, not an officer". This one
     * does, and it is the term.
     */
    '908c56f9-a1fa-4b2f-b989-f93b69b05d92': {
      role: 'MEMBER',
      duesPaidThrough: new Date('2099-12-31T23:59:59.999Z'),
    },

    /**
     * Caicheng Li, who exists in both databases.
     *
     * The address is the `@ucf.edu` one from the new database — it is what the
     * signup rules require and what his own survey gives as his UCF address.
     * The password stays the bcrypt hash from the old site, so the password he
     * already has still opens the account; it is only the address that moves.
     *
     * The dues date is the newer one: $25 paid for a semester, and the payment
     * record is carried across separately rather than being cascaded away with
     * the rest of the seed.
     */
    'a407aa2f-c791-4319-baff-618a6f202a9c': {
      email: 'ca741790@ucf.edu',
      duesPaidThrough: new Date('2026-12-11T04:59:59.999Z'),
    },

    /**
     * Matthew Barrs, also in both.
     *
     * The old database has him covered to September; the new one has a real
     * SUCCEEDED Stripe payment of $50 for a full year, to 2027-05-05. A
     * payment that happened outranks a date that predates it. His address stays
     * the old one, which is where his password is.
     */
    'e6a82399-ac82-4e2a-b301-9786475551a2': {
      duesPaidThrough: new Date('2027-05-05T03:59:59.999Z'),
    },
  },

  /**
   * Matthew Barrs signed up on this site as `matthew.barrs@ucf.edu` and paid
   * under it; the old database has him as `matthewbarrs@ucf.edu`, and that is
   * the address his password is attached to, so it is the one he keeps.
   *
   * Without this line his $50 is matched to nobody and silently thrown away
   * with the rest of the seed. Caicheng Li needs no entry: his override moves
   * him onto the same `@ucf.edu` address he paid under.
   */
  paymentEmails: {
    'matthew.barrs@ucf.edu': 'matthewbarrs@ucf.edu',
  },
}
