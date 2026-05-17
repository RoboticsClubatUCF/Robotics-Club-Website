import { prisma } from '$lib/server/prisma';
import { isHttpsUrl, parseId } from '$lib/server/security';
import { redirect, error } from '@sveltejs/kit';
import { SponsorTier, ImageSource } from '@prisma/client';
import { ROLES } from '$lib/constants';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user!.role.permissionLevel < ROLES.officer.level) {
		throw redirect(302, '/dashboard');
	}

	const sponsors = await prisma.sponsor.findMany({
		include: { logo: true },
		orderBy: { startedAt: 'asc' }
	});

	return { sponsors };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		if (locals.user!.role.permissionLevel < ROLES.officer.level) throw error(403);

		const form = await request.formData();
		const name = (form.get('name') as string)?.trim();
		const tier = form.get('tier') as SponsorTier;
		const websiteUrl = (form.get('websiteUrl') as string)?.trim() || null;
		const description = (form.get('description') as string)?.trim() || null;
		const amount = parseFloat(form.get('amount') as string) || null;
		const logoUrl = (form.get('logoUrl') as string)?.trim() || null;

		if (!name || !tier || !Object.values(SponsorTier).includes(tier)) {
			return { error: 'Name and valid tier are required.' };
		}
		if (amount !== null && amount < 0) return { error: 'Amount cannot be negative.' };
		if (websiteUrl && !isHttpsUrl(websiteUrl))
			return { error: 'Website URL must be a valid HTTPS URL.' };
		if (logoUrl && !isHttpsUrl(logoUrl)) return { error: 'Logo URL must be a valid HTTPS URL.' };

		await prisma.sponsor.create({
			data: {
				name,
				tier,
				websiteUrl,
				description,
				amount,
				...(logoUrl ? { logo: { create: { url: logoUrl, source: ImageSource.external } } } : {})
			}
		});
	},

	update: async ({ request, locals }) => {
		if (locals.user!.role.permissionLevel < ROLES.officer.level) throw error(403);

		const form = await request.formData();
		const id = parseId(form.get('id'));
		const name = (form.get('name') as string)?.trim();
		const tier = form.get('tier') as SponsorTier;
		const websiteUrl = (form.get('websiteUrl') as string)?.trim() || null;
		const description = (form.get('description') as string)?.trim() || null;
		const amount = parseFloat(form.get('amount') as string) || null;
		const logoUrl = (form.get('logoUrl') as string)?.trim() || null;

		if (!id || !name || !tier || !Object.values(SponsorTier).includes(tier)) {
			return { error: 'Missing required fields.' };
		}
		if (amount !== null && amount < 0) return { error: 'Amount cannot be negative.' };
		if (websiteUrl && !isHttpsUrl(websiteUrl))
			return { error: 'Website URL must be a valid HTTPS URL.' };
		if (logoUrl && !isHttpsUrl(logoUrl)) return { error: 'Logo URL must be a valid HTTPS URL.' };

		const existing = await prisma.sponsor.findUnique({ where: { id }, select: { imageId: true } });

		if (existing?.imageId && logoUrl) {
			await prisma.image.update({ where: { id: existing.imageId }, data: { url: logoUrl } });
			await prisma.sponsor.update({
				where: { id },
				data: { name, tier, websiteUrl, description, amount }
			});
		} else if (logoUrl) {
			await prisma.sponsor.update({
				where: { id },
				data: {
					name,
					tier,
					websiteUrl,
					description,
					amount,
					logo: { create: { url: logoUrl, source: ImageSource.external } }
				}
			});
		} else {
			await prisma.sponsor.update({
				where: { id },
				data: { name, tier, websiteUrl, description, amount }
			});
		}
	},

	delete: async ({ request, locals }) => {
		if (locals.user!.role.permissionLevel < ROLES.officer.level) throw error(403);

		const form = await request.formData();
		const id = parseId(form.get('id'));
		if (!id) return { error: 'Invalid sponsor ID.' };

		const sponsor = await prisma.sponsor.findUnique({ where: { id }, select: { imageId: true } });
		await prisma.sponsor.delete({ where: { id } });

		if (sponsor?.imageId) {
			try {
				await prisma.image.delete({ where: { id: sponsor.imageId } });
			} catch {
				// skip if still referenced elsewhere
			}
		}
	}
};
