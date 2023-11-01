import type { PageServerLoad } from './$types';

export const load = (async () => {
  const dog = async () => {
    var r = await fetch('https://dog.ceo/api/breeds/image/random');
    var dogLink = (await r.json()).message;
    return dogLink;
  };

  return { dog: await dog() };
}) satisfies PageServerLoad;
