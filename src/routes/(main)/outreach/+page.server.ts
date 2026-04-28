import { db } from '$lib/db';
import type { PageServerLoad } from './$types';

const INTRO_TEXT =
  'At the Robotics Club of Central Florida, one of our most important goals is breaking down barriers of entry to robotics and make robotics accessible for everyone. We recognize that diversity in STEM not only fosters innovation, creativity, and progress but can also become barriers for many people. That\'s why our outreach committee and its members\' initiatives focus on reaching a wide range of communities, ensuring that everyone, regardless of background, has the opportunity to explore and excel in robotics. Through inclusive workshops, presentations, and hands-on demonstrations, we strive to eliminate the barriers in the field of robotics and empower individuals to pursue their passion for technology.';

const COMMITMENT_TEXT =
  'Our dedication to robotics education and community outreach is built on a foundation of long-term commitment. We believe that meaningful change takes time, effort, and persistence, which is why semester after semester we try to find and attend any events that would have us voice our passions. From ongoing mentorship initiatives to annual events that spark curiosity and excitement, our focus is on creating lasting impacts in the short time that we have. By fostering partnerships with schools, community organizations, and industry leaders, we aim to ensure that the passion and love for robotics continue on. We hope that by inspiring young and dedicated students we grow not only the field of robotics in the future but also the students\' personal skills and outlook in life.';

const HOST_TEXT =
  "If you'd like to invite us to an event or school, please contact our outreach committee through this email:";

const CONTENT_KEYS = [
  'outreach.hero',
  'outreach.intro.text',
  'outreach.intro.image',
  'outreach.commitment.title',
  'outreach.commitment.text',
  'outreach.commitment.image',
  'outreach.hostUs.title',
  'outreach.hostUs.text',
  'outreach.hostUs.email'
];

export const load: PageServerLoad = async () => {
  const dbContent = await db.siteContent.findMany({ where: { key: { in: CONTENT_KEYS } } });
  const cm: Record<string, string> = {};
  for (const row of dbContent) cm[row.key] = row.value;

  return {
    siteContent: {
      hero: cm['outreach.hero'] ?? 'Breaking Down Barriers',
      introText: cm['outreach.intro.text'] ?? INTRO_TEXT,
      introImage:
        cm['outreach.intro.image'] ??
        'https://lh3.googleusercontent.com/pw/AP1GczPdz3pq6E17fE7f6YjqUzQtfVOaujT7a_a4N8-vUqdO9PjrYsHece4bivG92I1T1fppUhdRGdanhhn2KvGKl0dgIKPn3KQaMD-2KJmnrgjikn76K9E=w2400',
      commitmentTitle: cm['outreach.commitment.title'] ?? 'Commitment',
      commitmentText: cm['outreach.commitment.text'] ?? COMMITMENT_TEXT,
      commitmentImage:
        cm['outreach.commitment.image'] ??
        'https://lh3.googleusercontent.com/pw/AP1GczNKOzSo9rp15Wwa0Dx7y2r0ldjcYTP4rzXlcAde_l7zeTc8u_Ncc9ghgr8tKhP3qeZ99Br-ZXV-QT5TO9475A3kT1R3SRwRL28WXoPi31GQdIHVpN9cKd1T3sUInvdtzzR9HsMk0jjJ5zCCB0M8EGV0=w958-h639-s-no-gm?authuser=0',
      hostUsTitle: cm['outreach.hostUs.title'] ?? 'Host Us!',
      hostUsText: cm['outreach.hostUs.text'] ?? HOST_TEXT,
      hostUsEmail: cm['outreach.hostUs.email'] ?? 'outreach@rccf.club'
    }
  };
};
