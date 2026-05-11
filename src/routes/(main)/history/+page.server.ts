import { db } from '$lib/db';
import type { PageServerLoad } from './$types';

type TimelineItem = { date: string; title: string; description: string };

const DEFAULT_ITEMS: TimelineItem[] = [
  {
    date: 'March 2022',
    title: 'Marketing UI design in Figma',
    description:
      'All of the pages and components are first designed in Figma and we keep a parity between the two versions even as we update the project.'
  },
  {
    date: 'April 2022',
    title: 'E-Commerce UI code in Tailwind CSS',
    description:
      'Get started with dozens of web components and interactive elements built on top of Tailwind CSS.'
  }
];

export const load: PageServerLoad = async () => {
  const row = await db.siteContent.findUnique({ where: { key: 'history.items' } });

  let items: TimelineItem[] = DEFAULT_ITEMS;
  if (row) {
    try {
      items = JSON.parse(row.value);
    } catch {
      items = DEFAULT_ITEMS;
    }
  }

  return { items };
};
