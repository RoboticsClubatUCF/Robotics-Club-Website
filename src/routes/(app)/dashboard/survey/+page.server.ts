import { prisma } from '$lib/server/prisma';
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';

const surveySchema = z.object({
	majors: z.string().trim().max(80).array().min(1, 'Select at least one major').max(20),
	otherMajors: z.string().trim().max(250).optional(),
	year: z.string().trim().min(1, 'Select your year').max(40),
	numberOfSemesters: z.coerce.number().int().min(0).max(30),
	shirtSize: z.string().trim().min(1, 'Select a shirt size').max(20),
	prevMember: z.enum(['yes', 'no']),
	discoveredThrough: z.string().trim().max(80).array().min(1, 'Select at least one option').max(20),
	allergies: z.string().trim().max(80).array().min(1, 'Select at least one option').max(20),
	otherAllergies: z.string().trim().max(250).optional(),
	concerns: z.string().trim().max(2000).optional()
});

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user!.hasSurvey) throw redirect(302, '/dashboard');
	return {};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		if (!locals.user) return fail(401);

		const data = await request.formData();

		const raw = {
			majors: data.getAll('majors').map(String),
			otherMajors: data.get('otherMajors')?.toString() || undefined,
			year: data.get('year')?.toString() ?? '',
			numberOfSemesters: data.get('numberOfSemesters'),
			shirtSize: data.get('shirtSize')?.toString() ?? '',
			prevMember: data.get('prevMember')?.toString() ?? '',
			discoveredThrough: data.getAll('discoveredThrough').map(String),
			allergies: data.getAll('allergies').map(String),
			otherAllergies: data.get('otherAllergies')?.toString() || undefined,
			concerns: data.get('concerns')?.toString() || undefined
		};

		const parsed = surveySchema.safeParse(raw);
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0].message });
		}

		const {
			majors,
			otherMajors,
			year,
			numberOfSemesters,
			shirtSize,
			prevMember,
			discoveredThrough,
			allergies,
			otherAllergies,
			concerns
		} = parsed.data;

		if (prevMember === 'yes' && numberOfSemesters < 1) {
			return fail(400, { error: 'Enter number of semesters (must be ≥ 1 if previous member)' });
		}

		const surveyData = {
			majors,
			otherMajors: otherMajors || null,
			year,
			numberOfSemesters,
			shirtSize,
			prevMember: prevMember === 'yes',
			discoveredThrough,
			allergies,
			otherAllergies: otherAllergies || null,
			concerns: concerns || null
		};

		await prisma.survey.upsert({
			where: { userId: locals.user.id },
			create: { userId: locals.user.id, ...surveyData },
			update: surveyData
		});

		throw redirect(302, '/dashboard');
	}
};
