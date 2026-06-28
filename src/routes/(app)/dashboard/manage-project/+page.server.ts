import type { Actions, PageServerLoad } from './$types';
import { redirect, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import type { Season } from '@prisma/client';
import semesterYear from '../../../../components/scripts/semesterYear';
import { isDisplayableImageValue, pictureFieldsFromValue } from '$lib/imageRef';
import { safeDeletePhysical, pictureReferenceCount } from '$lib/server/assets';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.member.permissions.level < 8) {
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
    if (locals.member.permissions.level < 8) throw error(403, 'Forbidden');
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
    const discordRoleId = ((form.get('discordRoleId') as string) ?? '').trim() || '1111111';

    if (!title || !logoUrl || !docsLink || !season || !year) {
      return { error: 'Please fill in all required fields.' };
    }
    if (!isDisplayableImageValue(logoUrl)) {
      return { error: 'Image must be an https:// link or an uploaded file.' };
    }
    if (!docsLink.startsWith('https://')) {
      return { error: 'Documentation URL must start with https://' };
    }

    await db.project.create({
      data: {
        title,
        description,
        logo: { create: pictureFieldsFromValue(logoUrl) },
        docsLink,
        season,
        year,
        Skills: skills,
        discordRoleId,
        budget: 0,
        remainingFunds: 0
      }
    });
  },

  update: async ({ request, locals }) => {
    if (locals.member.permissions.level < 8) throw error(403, 'Forbidden');
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
    const discordRoleId = ((form.get('discordRoleId') as string) ?? '').trim() || '1111111';

    if (!title || !season || !year) {
      return { error: 'Missing required fields.' };
    }
    if (logoUrl && !isDisplayableImageValue(logoUrl)) {
      return { error: 'Image must be an https:// link or an uploaded file.' };
    }
    if (docsLink && !docsLink.startsWith('https://')) {
      return { error: 'Documentation URL must start with https://' };
    }

    const existing = await db.project.findUnique({
      where: { id },
      select: { pictureId: true, logo: { select: { storageKey: true } } }
    });
    const oldKey = existing?.logo?.storageKey ?? null;
    const base = { title, description, docsLink, season, year, Skills: skills, discordRoleId };

    if (logoUrl) {
      const pf = pictureFieldsFromValue(logoUrl);
      if (existing?.pictureId) {
        await db.picture.update({ where: { id: existing.pictureId }, data: pf });
        await db.project.update({ where: { id }, data: base });
      } else {
        await db.project.update({ where: { id }, data: { ...base, logo: { create: pf } } });
      }
      // If the logo swapped to a different file, clean up the orphaned upload.
      if (oldKey && oldKey !== pf.storageKey) {
        await safeDeletePhysical(oldKey, { exceptPictureId: existing?.pictureId ?? undefined });
      }
    } else {
      await db.project.update({ where: { id }, data: base });
    }
  },

  delete: async ({ request, locals }) => {
    if (locals.member.permissions.level < 8) throw error(403, 'Forbidden');
    const form = await request.formData();
    const id = parseInt(form.get('id') as string);

    const project = await db.project.findUnique({
      where: { id },
      select: { pictureId: true, logo: { select: { storageKey: true } } }
    });
    const pictureId = project?.pictureId ?? null;
    const storageKey = project?.logo?.storageKey ?? null;

    // Clear child records before deleting
    await db.article.deleteMany({ where: { projectId: id } });
    await db.tag.updateMany({ where: { projectId: id }, data: { projectId: null } });
    await db.record.updateMany({ where: { projectId: id }, data: { projectId: null } });
    await db.expendatureRequest.updateMany({ where: { projectId: id }, data: { projectId: null } });
    await db.team.updateMany({ where: { projectId: id }, data: { projectId: null } });

    await db.project.delete({ where: { id } });

    // Only drop the Picture (and its uploaded file) if nothing else still references it.
    if (pictureId && (await pictureReferenceCount(pictureId)) === 0) {
      await db.picture.delete({ where: { id: pictureId } });
      await safeDeletePhysical(storageKey, { exceptPictureId: pictureId });
    }
  },

  duplicate: async ({ request, locals }) => {
    if (locals.member.permissions.level < 8) throw error(403, 'Forbidden');
    const form = await request.formData();
    const id = parseInt(form.get('id') as string);

    const source = await db.project.findUnique({
      where: { id },
      include: { logo: true }
    });
    if (!source) return { error: 'Project not found.' };

    const { year, semester } = semesterYear();

    await db.project.create({
      data: {
        title: source.title,
        description: source.description,
        docsLink: source.docsLink,
        season: semester as Season,
        year,
        Skills: source.Skills,
        discordRoleId: source.discordRoleId,
        budget: 0,
        remainingFunds: 0,
        // Reuse the same uploaded file (shared storageKey) — don't copy it on disk.
        ...(source.logo
          ? {
              logo: {
                create: {
                  data: source.logo.data,
                  storageKey: source.logo.storageKey,
                  mimeType: source.logo.mimeType,
                  fit: source.logo.fit,
                  focalX: source.logo.focalX,
                  focalY: source.logo.focalY,
                  scale: source.logo.scale,
                  isLocal: source.logo.isLocal
                }
              }
            }
          : {})
      }
    });
  }
};
