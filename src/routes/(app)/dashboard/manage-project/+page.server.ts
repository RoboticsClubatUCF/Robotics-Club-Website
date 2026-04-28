import type { Actions, PageServerLoad } from './$types';
import { redirect, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import type { Season } from '@prisma/client';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.member.permissions.level < 10) {
    throw redirect(302, '/dashboard');
  }

  const projects = await db.project.findMany({
    orderBy: [{ year: 'desc' }, { createdAt: 'desc' }],
    include: { logo: true }
  });

  return { projects };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    if (locals.member.permissions.level < 10) throw error(403, 'Forbidden');
    const form = await request.formData();
    const title = (form.get('title') as string)?.trim();
    const description = (form.get('description') as string) ?? '';
    const logoUrl = (form.get('logo') as string)?.trim();
    const docsLink = (form.get('docsLink') as string)?.trim();
    const season = (form.get('season') as Season);
    const yearRaw = form.get('year') as string;
    const year = parseInt(yearRaw);
    const skillsRaw = (form.get('Skills') as string) ?? '';
    const skills = skillsRaw.split(',').map((s) => s.trim()).filter(Boolean);

    if (!title || !logoUrl || !docsLink || !season || !year) {
      return { error: 'Please fill in all required fields.' };
    }

    await db.project.create({
      data: {
        title,
        description,
        logo: { create: { data: logoUrl, isLocal: false } },
        docsLink,
        season,
        year,
        Skills: skills,
        budget: 0,
        remainingFunds: 0
      }
    });
  },

  update: async ({ request, locals }) => {
    if (locals.member.permissions.level < 10) throw error(403, 'Forbidden');
    const form = await request.formData();
    const id = parseInt(form.get('id') as string);
    const title = (form.get('title') as string)?.trim();
    const description = (form.get('description') as string) ?? '';
    const logoUrl = (form.get('logo') as string)?.trim();
    const docsLink = (form.get('docsLink') as string)?.trim();
    const season = form.get('season') as Season;
    const year = parseInt(form.get('year') as string);
    const skillsRaw = (form.get('Skills') as string) ?? '';
    const skills = skillsRaw.split(',').map((s) => s.trim()).filter(Boolean);

    if (!title || !season || !year) {
      return { error: 'Missing required fields.' };
    }

    const existing = await db.project.findUnique({ where: { id }, select: { pictureId: true } });

    if (existing?.pictureId && logoUrl) {
      await db.picture.update({ where: { id: existing.pictureId }, data: { data: logoUrl } });
      await db.project.update({
        where: { id },
        data: { title, description, docsLink, season, year, Skills: skills }
      });
    } else if (logoUrl) {
      await db.project.update({
        where: { id },
        data: {
          title, description, docsLink, season, year, Skills: skills,
          logo: { create: { data: logoUrl, isLocal: false } }
        }
      });
    } else {
      await db.project.update({
        where: { id },
        data: { title, description, docsLink, season, year, Skills: skills }
      });
    }
  },

  delete: async ({ request, locals }) => {
    if (locals.member.permissions.level < 10) throw error(403, 'Forbidden');
    const form = await request.formData();
    const id = parseInt(form.get('id') as string);

    const project = await db.project.findUnique({ where: { id }, select: { pictureId: true } });

    // Clear child records before deleting
    await db.article.deleteMany({ where: { projectId: id } });
    await db.record.updateMany({ where: { projectId: id }, data: { projectId: null } });
    await db.expendatureRequest.updateMany({ where: { projectId: id }, data: { projectId: null } });
    await db.team.updateMany({ where: { projectId: id }, data: { projectId: null } });

    await db.project.delete({ where: { id } });

    if (project?.pictureId) {
      try { await db.picture.delete({ where: { id: project.pictureId } }); } catch { /* skip if still referenced */ }
    }
  }
};
