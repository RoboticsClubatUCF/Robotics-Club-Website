export default {
  /**
   * Below are editable aspects of the website, from mission statement, to general info
   */
  information: {
    slogan: 'Building our future overlords one project at a time.',
    missionStatement:
      'The Robotics Club of Central Florida aims to further both ourselves and the field of robotics through our challenging and innovating projects. We value teamwork, perseverance, and having fun. '
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
