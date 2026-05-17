export type UcfSeason = 'spring' | 'summer' | 'fall';

interface UcfEvent {
	summary?: string;
	dtstart?: string;
	eventSession?: string | null;
	[key: string]: unknown;
}

interface UcfTerm {
	events: UcfEvent[];
}

interface UcfFeed {
	terms: UcfTerm[];
}

interface CachedTerm {
	events: UcfEvent[];
	fetchedAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const eventCache = new Map<string, CachedTerm>();

const FALLBACK_END: Record<UcfSeason, [number, number]> = {
	spring: [4, 6],
	summer: [7, 7],
	fall:   [11, 31]
};

const FALLBACK_START: Record<UcfSeason, [number, number]> = {
	spring: [0, 12],
	summer: [4, 18],
	fall:   [7, 24]
};

function termKey(year: number, season: UcfSeason) {
	return `${year}-${season}`;
}

function getActiveTerms(): Array<{ year: number; season: UcfSeason }> {
	const today = new Date();
	const year = today.getFullYear();
	const candidates: Array<{ year: number; season: UcfSeason }> = [
		{ year,           season: 'spring' },
		{ year,           season: 'summer' },
		{ year,           season: 'fall'   },
		{ year: year + 1, season: 'spring' },
		{ year: year + 1, season: 'summer' },
		{ year: year + 1, season: 'fall'   }
	];
	return candidates.filter(({ year: y, season }) => {
		const [endMonth, endDay] = FALLBACK_END[season];
		return new Date(y, endMonth, endDay) >= today;
	});
}

function pruneExpiredTerms(): void {
	const today = new Date();
	for (const key of eventCache.keys()) {
		const dashIdx = key.indexOf('-');
		const y = parseInt(key.slice(0, dashIdx));
		const season = key.slice(dashIdx + 1) as UcfSeason;
		const [endMonth, endDay] = FALLBACK_END[season];
		if (new Date(y, endMonth, endDay) < today) eventCache.delete(key);
	}
}

async function fetchTerm(year: number, season: UcfSeason): Promise<void> {
	const url = `https://calendar.ucf.edu/json/${year}/${season}`;
	try {
		const res = await fetch(url);
		if (res.ok) {
			const feed: UcfFeed = await res.json();
			const events = feed.terms[0]?.events ?? [];
			eventCache.set(termKey(year, season), { events, fetchedAt: Date.now() });
		} else {
			console.warn(`[UCF Calendar] HTTP ${res.status} for ${termKey(year, season)}`);
		}
	} catch (err) {
		console.error(`[UCF Calendar] Fetch failed for ${termKey(year, season)}:`, err);
	}
}

async function getEvents(year: number, season: UcfSeason): Promise<UcfEvent[]> {
	const key = termKey(year, season);
	const cached = eventCache.get(key);
	if (cached && cached.events.length > 0 && Date.now() - cached.fetchedAt < CACHE_TTL_MS)
		return cached.events;
	await fetchTerm(year, season);
	return eventCache.get(key)?.events ?? [];
}

function findDate(events: UcfEvent[], ...fragments: string[]): Date | null {
	for (const fragment of fragments) {
		const match =
			events.find((e) => e.eventSession === '1' && e.summary?.includes(fragment)) ??
			events.find((e) => e.summary?.includes(fragment));
		if (match?.dtstart) {
			const d = new Date(match.dtstart);
			if (!isNaN(d.getTime())) return d;
		}
	}
	return null;
}

export async function getSemesterEndDate(year: number, season: UcfSeason): Promise<Date> {
	const events = await getEvents(year, season);
	const found = findDate(events, 'On-Campus Housing Closes', 'Classes End', 'Commencement');
	if (found) return found;
	const [month, day] = FALLBACK_END[season];
	return new Date(year, month, day);
}

export async function getSemesterStartDate(year: number, season: UcfSeason): Promise<Date> {
	const events = await getEvents(year, season);
	const found = findDate(events, 'Classes Begin');
	if (found) return found;
	const [month, day] = FALLBACK_START[season];
	return new Date(year, month, day);
}

export async function initCalendarService(): Promise<void> {
	pruneExpiredTerms();
	const terms = getActiveTerms();
	await Promise.allSettled(terms.map((t) => fetchTerm(t.year, t.season)));
	console.log('[UCF Calendar] Initial fetch complete');
}

export async function runCalendarDiagnostics(): Promise<string[]> {
	const lines: string[] = [];
	const terms = getActiveTerms();

	lines.push(`Diagnostic run at ${new Date().toISOString()}`);
	lines.push(`Checking ${terms.length} terms...`);

	for (const { year: y, season } of terms) {
		const key = termKey(y, season);
		const cached = eventCache.get(key);
		const isFresh = !!cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;

		if (isFresh) {
			const ageMin = Math.round((Date.now() - cached!.fetchedAt) / 60_000);
			lines.push(`[${y} ${season}] cache hit — ${cached!.events.length} events, ${ageMin}m old`);
		} else {
			lines.push(`[${y} ${season}] cache miss — fetching from UCF API...`);
			await fetchTerm(y, season);
			const after = eventCache.get(key);
			lines.push(
				!after
					? `[${y} ${season}] fetch failed — fallback dates will be used`
					: after.events.length > 0
						? `[${y} ${season}] fetched ${after.events.length} events OK`
						: `[${y} ${season}] fetched 0 events — using default dates`
			);
		}

		const [start, end] = await Promise.all([
			getSemesterStartDate(y, season),
			getSemesterEndDate(y, season)
		]);
		lines.push(`[${y} ${season}] start -> ${start.toDateString()}`);
		lines.push(`[${y} ${season}] end   -> ${end.toDateString()}`);
	}

	lines.push('Done.');
	return lines;
}
