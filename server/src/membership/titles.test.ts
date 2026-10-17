import { describe, expect, it } from 'vitest'
import { claimsOf } from './titles.js'

/**
 * What a title claims, read off the words alone. No database: standing is the routes'
 * half and is tested there.
 */

const claims = (title: string) => claimsOf(title)

describe('claimsOf', () => {
  it.each([
    'Chassis wiring',
    'Rover software',
    'Assistant to the lab',
    'Class clown',
    'Scunthorpe fan',
    'Marketing team',
    'Outreach volunteer',
    'Circuit board designer',
    'Leadership program alum',
    'Badminton champion',
    'Wheelchair basketball',
    // Club words that look like claims and aren't.
    'Lead screw design',
    'Test leads',
    'Lead-free solder',
    'Cheerleader',
    'Plead the fifth',
    'Gear head',
    'Directory keeper',
    'Collab manager',
    'Peer advisor',
    'Electrical',
    'Headlight wiring',
    'Chairless',
    'Spearhead',
    'Figurehead',
    'Misleading',
    'Press team',
    'Prep cook',
    // Words the obscenity list trips on.
    'Cockpit design',
    'Magna cum laude',
    'Dickinson fan',
    'Shiitake grower',
  ])('claims nothing for %j', (title) => {
    expect(claims(title)).toEqual({ obscene: false, office: false, lead: false })
  })

  it.each([
    'President',
    'Vice President',
    'Co-President',
    'VicePresident',
    'Pr3sident',
    'Treasurer',
    'Club Secretary',
    'Lab Manager',
    'Faculty Advisor',
    'Marketing',
    'Outreach',
    'Head of Outreach',
    'Marketing Coordinator',
    'V.P. of Fun',
    'VP',
    'Chair',
    'Events Director',
    'Officer at large',
    'Site admin',
    'Board member',
    'Présidente',
    'Executive Board',
    'Club Officer',
    // Abbreviations.
    'Pres.',
    'Prez',
    'Sec/Treas',
    'Treas.',
    'Secy',
    'Vice-Pres',
    'Veep',
    'E-Board',
    'Exec',
    'Club P.R.E.S.',
    'Prés',
    // Punctuation after the word, which once read as a letter.
    'VP!',
    'Chair!',
    'Admin!',
    // Characters that draw like the word without being it.
    'Club Prеsident',
    'Pres​ident',
    'Ｐｒｅｓｉｄｅｎｔ',
  ])('reads %j as claiming an office', (title) => {
    expect(claims(title).office).toBe(true)
  })

  it.each([
    'Rover Lead',
    'Software Lead',
    'Team Captain',
    'Head of Mechanical',
    'Chief Engineer',
    'Co-Lead',
    'TeamLead',
    'L3ad',
    'Head TA',
    'Team Lead!',
    'Rover Lead1',
    'Lead|',
    'Lead@',
    'Captain!',
    'Head!',
    'Chief!',
    'Le​ad',
    'Le­ad',
    'Leаd',
  ])('reads %j as claiming a lead', (title) => {
    expect(claims(title).lead).toBe(true)
  })

  it.each(['fvck this', 'sh1t poster', 'f u c k', 'F.U.C.K', 'f​uck'])(
    'reads %j as obscene',
    (title) => {
      expect(claims(title).obscene).toBe(true)
    },
  )
})
