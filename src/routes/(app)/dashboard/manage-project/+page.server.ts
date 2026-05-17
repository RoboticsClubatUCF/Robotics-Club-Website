import { prisma } from '$lib/server/prisma';
import { isHttpsUrl, parseId } from '$lib/server/security';
import { redirect, error } from '@sveltejs/kit';
import { Season, ImageSource } from '@prisma/client';
import { getCurrentSemester } from '$lib/currentSemester';
import { ROLES } from '$lib/constants';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user!.role.permissionLevel < ROLES.projectLead.level) {
		throw redirect(302, '/dashboard');
	}

	const projects = await prisma.project.findMany({
		orderBy: [{ year: 'desc' }, { createdAt: 'desc' }],
		include: { logo: true }
	});

	return { projects };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		if (locals.user!.role.permissionLevel < ROLES.projectLead.level) throw error(403);

		const form = await request.formData();
		const title = (form.get('title') as string)?.trim();
		const description = (form.get('description') as string) ?? '';
		const logoUrl = (form.get('logoUrl') as string)?.trim();
		const docsLink = (form.get('docsLink') as string)?.trim() || null;
		const season = form.get('season') as Season;
		const year = Number(form.get('year'));
		const skillsRaw = (form.get('skills') as string) ?? '';
		const skills = skillsRaw
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		const discordRoleId = (form.get('discordRoleId') as string)?.trim() || null;

		if (!title || !Object.values(Season).includes(season) || !Number.isInteger(year)) {
			return { error: 'Missing required fields.' };
		}
		if (logoUrl && !isHttpsUrl(logoUrl)) return { error: 'Logo URL must be a valid HTTPS URL.' };
		if (docsLink && !isHttpsUrl(docsLink)) return { error: 'Docs URL must be a valid HTTPS URL.' };

		await prisma.project.create({
			data: {
				title,
				description,
				docsLink,
				season,
				year,
				skills,
				discordRoleId,
				...(logoUrl ? { logo: { create: { url: logoUrl, source: ImageSource.external } } } : {})
			}
		});
	},

	update: async ({ request, locals }) => {
		if (locals.user!.role.permissionLevel < ROLES.projectLead.level) throw error(403);

		const form = await request.formData();
		const id = parseId(form.get('id'));
		const title = (form.get('title') as string)?.trim();
		const description = (form.get('description') as string) ?? '';
		const logoUrl = (form.get('logoUrl') as string)?.trim();
		const docsLink = (form.get('docsLink') as string)?.trim() || null;
		const season = form.get('season') as Season;
		const year = Number(form.get('year'));
		const skillsRaw = (form.get('skills') as string) ?? '';
		const skills = skillsRaw
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		const discordRoleId = (form.get('discordRoleId') as string)?.trim() || null;

		if (!id || !title || !Object.values(Season).includes(season) || !Number.isInteger(year)) {
			return { error: 'Missing required fields.' };
		}
		if (logoUrl && !isHttpsUrl(logoUrl)) return { error: 'Logo URL must be a valid HTTPS URL.' };
		if (docsLink && !isHttpsUrl(docsLink)) return { error: 'Docs URL must be a valid HTTPS URL.' };

		const existing = await prisma.project.findUnique({ where: { id }, select: { imageId: true } });

		if (existing?.imageId && logoUrl) {
			await prisma.image.update({ where: { id: existing.imageId }, data: { url: logoUrl } });
			await prisma.project.update({
				where: { id },
				data: { title, description, docsLink, season, year, skills, discordRoleId }
			});
		} else if (logoUrl) {
			await prisma.project.update({
				where: { id },
				data: {
					title,
					description,
					docsLink,
					season,
					year,
					skills,
					discordRoleId,
					logo: { create: { url: logoUrl, source: ImageSource.external } }
				}
			});
		} else {
			await prisma.project.update({
				where: { id },
				data: { title, description, docsLink, season, year, skills, discordRoleId }
			});
		}
	},

	delete: async ({ request, locals }) => {
		if (locals.user!.role.permissionLevel < ROLES.projectLead.level) throw error(403);

		const form = await request.formData();
		const id = parseId(form.get('id'));
		if (!id) return { error: 'Invalid project ID.' };

		const project = await prisma.project.findUnique({ where: { id }, select: { imageId: true } });

		// ProjectUser records cascade via onDelete: Cascade defined in schema
		await prisma.project.delete({ where: { id } });

		if (project?.imageId) {
			try {
				await prisma.image.delete({ where: { id: project.imageId } });
			} catch {
				// skip if still referenced elsewhere
			}
		}
	},

	duplicate: async ({ request, locals }) => {
		if (locals.user!.role.permissionLevel < ROLES.projectLead.level) throw error(403);

		const form = await request.formData();
		const id = parseId(form.get('id'));
		if (!id) return { error: 'Invalid project ID.' };

		const source = await prisma.project.findUnique({ where: { id }, include: { logo: true } });
		if (!source) return { error: 'Project not found.' };

		const { year, semester } = await getCurrentSemester();

		await prisma.project.create({
			data: {
				title: source.title,
				description: source.description,
				docsLink: source.docsLink,
				season: semester,
				year,
				skills: source.skills,
				discordRoleId: source.discordRoleId,
				...(source.logo
					? { logo: { create: { url: source.logo.url, source: source.logo.source } } }
					: {})
			}
		});
	}
};
