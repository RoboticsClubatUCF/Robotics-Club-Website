export default {
  paypal: {
    CLIENT_ID: 'ARJagxbcowj9UZZo7rdH0xB6h7LVkkz2u5Pl9qqkwxfhp9gbngL62XlDtVLAhJw12X2ubAZvJit8FcRV',
    semester_cost: '25.00',
    year_cost: '50.00'
  },

  /**
   * Below are editable aspects of the website, from mission statement, to general info
   */
  information: {
    slogan: 'Building our future overlords, one project at a time.',
    outreach: {
      hero: 'Breaking down barriers'
    },
    missionStatement:
      'The Robotics Club of Central Florida aims to further both ourselves and the field of robotics through our challenging and innovating projects. We value teamwork, perseverance, and having fun. ',
    projectStatement:
      'Students are encouraged to learn hands on skills and methods not only in the field of robotics, but engineering overall, through challenging and stimulating projects.',
    teachingStatement:
      'Members are offered a multitude of learning resources, spanning from hands on workshops, to well-written documentation.',
    competitionStatement:
      'The Robotics Club of Central Florida engages in many difficult nationwide competitions, revolving around innovating current solutions, and discovering new ones.',
    outreachStatement:
      'The Robotics Club of Central Florida gives back to the community with several opportunities for members to attend events, but also to local schools and organizations looking to have an extra set of hands.',
    researchStatement:
      'Team Leads often host complex and exciting research through RCCF, and often get to work with bleeding edge technologies.'
  },

  /**
   * Below are generic roles that can be assigned to members,
   * at no point are these set in stone, more so , that they are a template for their permission level, a higher number being the order of preference
   *
   * when roles in the future etc. Treasurser, come in to play, they can have a permission level to themselves, or even
   */
  roles: {
    officer: {
      level: 10,
      name: 'officer'
    },
    lead: {
      level: 8,
      name: 'lead'
    },
    committee: {
      level: 6,
      name: 'committee'
    },
    member: {
      level: 4,
      name: 'member'
    },
    guest: {
      level: 0,
      name: 'guest'
    }
  }
};
