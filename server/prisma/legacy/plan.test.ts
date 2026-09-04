import { describe, expect, it } from 'vitest'
import { UserRole } from '../../src/generated/prisma/enums.js'
import { type Row, parseArray, parseTimestamp } from './dump.js'
import {
  type MappedUser,
  type Question,
  assignSlugs,
  duesPaidThroughOf,
  mapSurvey,
  mapUser,
  mergeUsers,
  photoOf,
  roleOf,
  slugify,
  sponsorLogoOf,
  sponsorTierOf,
} from './plan.js'

/**
 * The import's decisions, tested away from both databases.
 *
 * Everything in `plan.ts` is a pure function of a dump row, which is why it was split out: the
 * import runs once, against seven hundred real people, and the only way to be sure about a rule
 * like "a date equal to `joinedAt` is a default, not a payment" is to state it as a case before the
 * run rather than to read the result afterwards and hope it looks right.
 *
 * No database, no Prisma, no fixtures to clean up.
 */

const ROLES = new Map([
  ['1', 'guest'],
  ['2', 'member'],
  ['3', 'officer'],
  ['4', 'project lead'],
  ['6', 'admin'],
])

const NOW = new Date('2026-08-27T12:00:00Z')

/** A dump row with every column present, so a test only states what it varies. */
function member(overrides: Partial<Row> = {}): Row {
  return {
    id: 'legacy-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@ucf.edu',
    discordProfileName: 'ada',
    passwordHash: '$2b$12$abcdefghijklmnopqrstuv',
    AuthToken: 'token',
    membershipExpDate: '2027-01-31 00:00:00',
    joinedAt: '2024-01-15 10:00:00',
    updatedAt: '2026-01-01 10:00:00',
    roleId: '2',
    accountId: null,
    surveyId: null,
    acknowledgedAt: null,
    bio: null,
    position: null,
    profileLink: null,
    profilePictureUrl: null,
    ...overrides,
  }
}

describe('parseArray', () => {
  it('reads the shapes the old survey stored', () => {
    expect(parseArray('{}')).toEqual([])
    expect(parseArray(null)).toEqual([])
    expect(parseArray('{None}')).toEqual(['None'])
    // The trailing space is real and every option in the dump has one — the
    // parser must not tidy it away, because whether it matters is the mapping's
    // decision.
    expect(parseArray('{"Mechanical Engineering "}')).toEqual(['Mechanical Engineering '])
    expect(parseArray('{"Nuts ","Shellfish "}')).toEqual(['Nuts ', 'Shellfish '])
    expect(parseArray('{"Class Presentations Fall","EGS 1006C "}')).toEqual([
      'Class Presentations Fall',
      'EGS 1006C ',
    ])
  })
})

describe('parseTimestamp', () => {
  it('reads a naive timestamp as UTC, not as local time', () => {
    // The dump has no zone on it. Without the explicit `Z` the same file would
    // import differently in Orlando and in London, moving every dues date by
    // five hours.
    expect(parseTimestamp('2026-05-31 00:00:00')?.toISOString()).toBe('2026-05-31T00:00:00.000Z')
    expect(parseTimestamp('2024-01-30 19:28:26.387')?.toISOString()).toBe(
      '2024-01-30T19:28:26.387Z',
    )
  })

  it('is null for a missing or unreadable value', () => {
    expect(parseTimestamp(null)).toBeNull()
    expect(parseTimestamp('')).toBeNull()
    expect(parseTimestamp('not a date')).toBeNull()
  })
})

describe('slugify', () => {
  it('drops dots rather than turning them into separators', () => {
    expect(slugify('Project S.T.O.R.M.')).toBe('project-storm')
  })

  it('leaves the emoji out of the URL', () => {
    expect(slugify('🌩Project S.T.O.R.M.')).toBe('project-storm')
  })

  it('folds accents', () => {
    expect(slugify('Jorge Gómez')).toBe('jorge-gomez')
  })

  it('keeps distinct titles distinct', () => {
    expect(slugify('AGV 2024 (Otto)')).toBe('agv-2024-otto')
    expect(slugify('HydroKnights - PEP27')).toBe('hydroknights-pep27')
  })
})

describe('duesPaidThroughOf', () => {
  /**
   * The single most consequential rule in the import. The old column defaulted
   * to `now()`, so an untouched row reads as "paid up to the instant they
   * signed up" — which the demotion sweep would treat as a lapsed member and
   * write a lapse that never happened into the club's records.
   */
  it('is null when the date is the old default firing', () => {
    const row = member({ membershipExpDate: '2024-01-15 10:00:00', joinedAt: '2024-01-15 10:00:00' })

    expect(duesPaidThroughOf(row)).toBeNull()
  })

  it('is the date when somebody actually paid', () => {
    expect(duesPaidThroughOf(member())?.toISOString()).toBe('2027-01-31T00:00:00.000Z')
  })

  it('does not treat a near-miss as a default', () => {
    const row = member({
      joinedAt: '2024-01-15 10:00:00',
      membershipExpDate: '2024-01-15 10:00:01',
    })

    expect(duesPaidThroughOf(row)).not.toBeNull()
  })
})

describe('roleOf', () => {
  it('reads admin and officer off the old role', () => {
    expect(roleOf(member({ roleId: '6' }), ROLES, NOW)).toBe(UserRole.ADMIN)
    expect(roleOf(member({ roleId: '3' }), ROLES, NOW)).toBe(UserRole.OFFICER)
  })

  it('promotes a paying guest, because dues are what membership means here', () => {
    // 451 rows in the dump are exactly this: labelled `guest` by the old site
    // while paid up to a real date months away.
    const paying = member({ roleId: '1', membershipExpDate: '2027-01-31 00:00:00' })

    expect(roleOf(paying, ROLES, NOW)).toBe(UserRole.MEMBER)
  })

  it('leaves a guest who never paid a guest', () => {
    const never = member({
      roleId: '1',
      membershipExpDate: '2024-01-15 10:00:00',
      joinedAt: '2024-01-15 10:00:00',
    })

    expect(roleOf(never, ROLES, NOW)).toBe(UserRole.GUEST)
  })

  it('collapses the old global lead labels to MEMBER', () => {
    // Leading a project is a `ProjectMember.rank` against one project here, not
    // a permission level somebody carries everywhere.
    expect(roleOf(member({ roleId: '4' }), ROLES, NOW)).toBe(UserRole.MEMBER)
  })
})

describe('photoOf', () => {
  it('passes a plain URL through', () => {
    const row = member({ profilePictureUrl: 'https://example.com/a.jpg' })

    expect(photoOf(row)).toEqual({
      photoUrl: 'https://example.com/a.jpg',
      photoFocalX: 50,
      photoFocalY: 50,
      photoZoom: 1,
    })
  })

  it('unpacks the JSON blob the old site stored framing in', () => {
    const row = member({
      profilePictureUrl:
        '{"src":"https://example.com/b.jpg","fit":"cover","focalX":50,"focalY":45,"scale":1.8}',
    })

    expect(photoOf(row)).toEqual({
      photoUrl: 'https://example.com/b.jpg',
      photoFocalX: 50,
      photoFocalY: 45,
      photoZoom: 1.8,
    })
  })

  it('falls back rather than throwing on a blob it cannot read', () => {
    const row = member({ profilePictureUrl: '{not json' })

    expect(photoOf(row).photoUrl).toBe('{not json')
  })
})

describe('mergeUsers', () => {
  const base = (overrides: Partial<MappedUser>): MappedUser => ({
    ...mapUser(member(), ROLES, new Map(), NOW),
    ...overrides,
  })

  it('never moves a dues date backwards', () => {
    const merged = mergeUsers(
      base({ duesPaidThrough: new Date('2026-01-31') }),
      base({ duesPaidThrough: new Date('2027-01-31') }),
    )

    expect(merged.duesPaidThrough?.toISOString()).toBe(new Date('2027-01-31').toISOString())
  })

  it('keeps the earlier join date — the club has known them since the first signup', () => {
    const merged = mergeUsers(
      base({ joinedAt: new Date('2025-06-01') }),
      base({ joinedAt: new Date('2024-02-01') }),
    )

    expect(merged.joinedAt?.toISOString()).toBe(new Date('2024-02-01').toISOString())
  })

  it('takes the name from whichever row has one', () => {
    const merged = mergeUsers(base({ fullName: '' }), base({ fullName: 'Patrick Keeney' }))

    expect(merged.fullName).toBe('Patrick Keeney')
  })

  it('does not swap a working password for the other account’s', () => {
    const merged = mergeUsers(
      base({ passwordHash: 'scrypt$keep' }),
      base({ passwordHash: 'scrypt$drop' }),
    )

    expect(merged.passwordHash).toBe('scrypt$keep')
  })

  it('fills a missing handle from the other row', () => {
    const merged = mergeUsers(
      base({ discordUsername: null }),
      base({ discordUsername: 'valeriach08' }),
    )

    expect(merged.discordUsername).toBe('valeriach08')
  })

  it('takes the higher standing of the two', () => {
    expect(
      mergeUsers(base({ role: UserRole.GUEST }), base({ role: UserRole.MEMBER })).role,
    ).toBe(UserRole.MEMBER)
    expect(
      mergeUsers(base({ role: UserRole.OFFICER }), base({ role: UserRole.MEMBER })).role,
    ).toBe(UserRole.OFFICER)
  })
})

describe('assignSlugs', () => {
  const person = (
    name: string,
    through: string | null,
    role: UserRole = UserRole.MEMBER,
  ): MappedUser => ({
    ...mapUser(member(), ROLES, new Map(), NOW),
    legacyId: name,
    fullName: name,
    role,
    duesPaidThrough: through === null ? null : new Date(through),
    slug: null,
  })

  it('publishes a member whose dues cover today', () => {
    const users = [person('Ada Lovelace', '2027-01-31')]

    assignSlugs(users, new Set(), NOW)

    expect(users[0]!.slug).toBe('ada-lovelace')
  })

  it('does not publish a member whose dues have run out', () => {
    const users = [person('Ada Lovelace', '2024-05-31')]

    assignSlugs(users, new Set(), NOW)

    expect(users[0]!.slug).toBeNull()
  })

  it('does not publish a guest, whatever they paid', () => {
    const users = [person('Ada Lovelace', '2027-01-31', UserRole.GUEST)]

    assignSlugs(users, new Set(), NOW)

    expect(users[0]!.slug).toBeNull()
  })

  it('publishes an officer regardless of dues', () => {
    const users = [person('Gavin Fitzgerald', null)]

    assignSlugs(users, new Set(['Gavin Fitzgerald']), NOW)

    expect(users[0]!.slug).toBe('gavin-fitzgerald')
  })

  it('never gives two people the same URL', () => {
    const users = [person('Sam Okafor', '2027-01-31'), person('Sam Okafor', '2027-01-31')]

    assignSlugs(users, new Set(), NOW)

    expect(users[0]!.slug).toBe('sam-okafor')
    expect(users[1]!.slug).toBe('sam-okafor-2')
  })
})

describe('mapSurvey', () => {
  /** The six live questions, as the migration creates them. */
  const questions: Question[] = [
    {
      id: 'q-major',
      prompt: 'Major',
      kind: 'SINGLE_CHOICE',
      options: [
        { id: 'o-mech', label: 'Mechanical Engineering', wantsText: false },
        { id: 'o-cs', label: 'Computer Science', wantsText: false },
        { id: 'o-major-other', label: 'Other', wantsText: true },
      ],
    },
    {
      id: 'q-shirt',
      prompt: 'Shirt size',
      kind: 'SINGLE_CHOICE',
      options: [
        { id: 'o-m', label: 'M', wantsText: false },
        { id: 'o-2xl', label: '2XL', wantsText: false },
      ],
    },
    {
      id: 'q-allerg',
      prompt: 'Allergies',
      kind: 'MULTI_CHOICE',
      options: [
        { id: 'o-nuts', label: 'Nuts', wantsText: false },
        { id: 'o-allerg-other', label: 'Other', wantsText: false },
      ],
    },
    { id: 'q-diet', prompt: 'Dietary restrictions', kind: 'MULTI_CHOICE', options: [] },
    { id: 'q-food', prompt: 'Anything else about food', kind: 'LONG_TEXT', options: [] },
    {
      id: 'q-found',
      prompt: 'How did you find out about the club',
      kind: 'SINGLE_CHOICE',
      options: [
        { id: 'o-google', label: 'Google', wantsText: false },
        { id: 'o-friends', label: 'Friends', wantsText: false },
        { id: 'o-found-other', label: 'Other', wantsText: true },
      ],
    },
  ]

  const survey = (overrides: Partial<Row> = {}): Row => ({
    id: 's-1',
    GitName: null,
    UCFemail: 'ab123456@ucf.edu',
    Major: '{"Mechanical Engineering "}',
    Year: 'Junior',
    ShirtSize: 'M',
    PrevMem: 'No',
    Allergies: '{None}',
    Concerns: null,
    NumberofSemesters: '0',
    OtherAllergies: null,
    OtherMajors: null,
    DateCreated: '2025-08-01 10:00:00',
    DateUpdated: null,
    DiscoveredThrough: '{"Friend(s) "}',
    ...overrides,
  })

  const answerFor = (row: Row, questionId: string) =>
    mapSurvey(row, questions).find((a) => a.questionId === questionId)

  it('matches an option through the trailing space the old form saved', () => {
    expect(answerFor(survey(), 'q-major')).toEqual({
      questionId: 'q-major',
      text: null,
      optionIds: ['o-mech'],
    })
  })

  /**
   * The bug this case exists for: both forms call the escape hatch "Other", so
   * a plain label match resolves the old `{Other}` onto the new *Other* — an
   * option with `wantsText`, picked with an empty box, which is a state
   * `routes/member/survey.ts` refuses and the member cannot re-save.
   */
  it('sends an explicit Other to the free-text branch, carrying its own text', () => {
    const row = survey({ Major: '{Other}', OtherMajors: 'Civil Engineering' })

    expect(answerFor(row, 'q-major')).toEqual({
      questionId: 'q-major',
      text: 'Civil Engineering',
      optionIds: ['o-major-other'],
    })
  })

  it('never picks Other with nothing in the box', () => {
    const row = survey({ Major: '{Other}', OtherMajors: null })
    const answer = answerFor(row, 'q-major')

    expect(answer?.optionIds).toEqual(['o-major-other'])
    expect(answer?.text).not.toBe('')
    expect(answer?.text).not.toBeNull()
  })

  it('keeps the first of two majors, since the question is single-choice now', () => {
    const row = survey({ Major: '{"Mechanical Engineering ",Other}' })

    expect(answerFor(row, 'q-major')?.optionIds).toEqual(['o-mech'])
  })

  it('relabels XXL as 2XL', () => {
    expect(answerFor(survey({ ShirtSize: 'XXL' }), 'q-shirt')?.optionIds).toEqual(['o-2xl'])
  })

  it('turns "None" into an empty tick set rather than an option', () => {
    // `allowNone` is what an empty set means on this question. There is no NONE
    // option row and there must not be one.
    expect(answerFor(survey(), 'q-allerg')).toEqual({
      questionId: 'q-allerg',
      text: null,
      optionIds: [],
    })
  })

  it('ticks the allergies somebody actually listed', () => {
    const row = survey({ Allergies: '{"Nuts ",Other}' })

    expect(answerFor(row, 'q-allerg')?.optionIds).toEqual(['o-nuts', 'o-allerg-other'])
  })

  it('puts the old allergy free-text into the food box', () => {
    const row = survey({ OtherAllergies: 'Cats, Pollen' })

    expect(answerFor(row, 'q-food')).toEqual({
      questionId: 'q-food',
      text: 'Cats, Pollen',
      optionIds: [],
    })
  })

  it('leaves dietary restrictions unanswered, because the old form never asked', () => {
    expect(answerFor(survey(), 'q-diet')).toBeUndefined()
  })

  it('maps the wording that changed', () => {
    expect(answerFor(survey({ DiscoveredThrough: '{"Friend(s) "}' }), 'q-found')?.optionIds).toEqual(
      ['o-friends'],
    )
    expect(answerFor(survey({ DiscoveredThrough: '{"Google "}' }), 'q-found')?.optionIds).toEqual([
      'o-google',
    ])
  })

  it('sends a choice the new form does not offer to Other, keeping the words', () => {
    const row = survey({ DiscoveredThrough: '{"Knight Connect "}' })

    expect(answerFor(row, 'q-found')).toEqual({
      questionId: 'q-found',
      text: 'Knight Connect',
      optionIds: ['o-found-other'],
    })
  })

  it('sends a multi-select answer to Other, since the question is single-choice now', () => {
    const row = survey({ DiscoveredThrough: '{"Friend(s) ","Events "}' })

    expect(answerFor(row, 'q-found')).toEqual({
      questionId: 'q-found',
      text: 'Friend(s), Events',
      optionIds: ['o-found-other'],
    })
  })

  it('answers nothing for a question that has been renamed past recognition', () => {
    const renamed = questions.map((q) =>
      q.id === 'q-shirt' ? { ...q, prompt: 'What size do you take' } : q,
    )

    expect(mapSurvey(survey(), renamed).some((a) => a.questionId === 'q-shirt')).toBe(false)
  })
})

describe('sponsors', () => {
  it('maps the old lowercase tier', () => {
    expect(sponsorTierOf('bolt')).toBe('BOLT_BACKER')
    expect(sponsorTierOf(null)).toBe('ALUMINUM_ALLY')
  })

  it('takes the src out of the framing blob', () => {
    expect(
      sponsorLogoOf('{"src":"https://example.com/logo.jpg","fit":"contain","scale":1.95}'),
    ).toBe('https://example.com/logo.jpg')
  })

  it('passes a plain URL through', () => {
    expect(sponsorLogoOf('https://example.com/logo.jpg')).toBe('https://example.com/logo.jpg')
    expect(sponsorLogoOf(null)).toBeNull()
  })
})
