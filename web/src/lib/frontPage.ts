/**
 * What the front-page desk may offer, mirrored off the routes that enforce it.
 *
 * The sibling of `heroSlides.ts` and `sponsorship.ts`, and here for the same reason: a form that
 * offers what the API refuses is the failure this convention prevents, and the desk needs the
 * numbers to grey out ADD and say why. The real limits are `MAX_FAQS`, `MAX_FAQ_STEPS` and
 * `MAX_PARTNERS` in `server/src/routes/officer/frontPage.ts` — change one and change the other.
 *
 * The slideshow's cap is not here: it is `MAX_HERO_SLIDES` in `heroSlides.ts`, where the rest of
 * the slideshow's arithmetic lives. One desk, two files, because the photographs and the words are
 * two features that happen to be edited on one screen.
 */

/** How many questions the FAQ will carry. The club asks eight. */
export const MAX_FAQS = 20

/** How many numbered steps one answer may have. The club's longest is four. */
export const MAX_FAQ_STEPS = 6

/** How many partner programs the section will hold — three rows of two. */
export const MAX_PARTNERS = 6
