export default {
  paypal: {
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
      'The Robotics Club of Central Florida (RCCF) aims to involve students in the field of robotics and further both ourselves and the field of robotics through challenging and innovative projects. RCCF is not only a club where you go to learn about robotics but also a place to gain invaluable opportunities and skills. Anyone is welcomed so come and be a part of the club!',
    projectStatement:
      'RCCF offers a wide variety of different projects. Every project is led by a project lead who makes sure students have everything they need to get the most out of their project and team leads that make sure students are involved and learning as much as possible. All projects are drop-in certified, meaning that no formal skills are required!',
    teachingStatement:
      'Members are also offered special workshops in which they get hands-on and use/create various components and systems. For members and non-members RCCF also offers various workshops and opportunities such as programming and resume critiques. RCCF offers a multitude of learning resources and opportunities so come visit us during one of our workshops!',
    competitionStatement:
      'Members of competition based projects are given the opportunity to compete against other clubs and organizations nationwide. They will get to represent the club at official competition events and gain the opportunity to connect with many industry leaders in the process. As RCCF expands as a club we’ll only get more involved in competitions so if that interests you give us a visit!',
    outreachStatement:
      'RCCF is also involved in much of the surrounding STEM communities as we aim to offer the same opportunities to as many people as possible. Members of our outreach committee often go out of their way to get involved in STEM related conventions and events such as Maker Fair and STEM Day at UCF. Members often volunteer their own time for these events so if you want to sponsor one please go check out our sponsors page!',
    researchStatement:
      'Our projects often include various opportunities to join and collaborate on research. Tape Measure, our resident robotic companion, is one such project that involves research. Research at RCCF is not a formal one so you get all the benefits for being a part of a research team without the pressure of a deadline or failure. RCCF research projects often involve the bleeding edge of technologies so join in on the fun!'
  },

  /**
   * Below are generic roles that can be assigned to members,
   * at no point are these set in stone, more so , that they are a template for their permission level, a higher number being the order of preference
   *
   * when roles in the future etc. Treasurser, come in to play, they can have a permission level to themselves, or even
   */
  roles: {
    admin:{
      level: 5,
      name: 'admin'
    },
    president:{
      level: 5,
      name: 'president'
    },
    officers: {
      level: 4,
      name: 'officers'
    },
    project_lead:{
      level: 3,
      name: 'project lead'
    },
    team_lead: {
      level: 2,
      name: 'lead'
    },
    member: {
      level: 1,
      name: 'member'
    },
    guest: {
      level: 0,
      name: 'guest'
    }
  }
};
