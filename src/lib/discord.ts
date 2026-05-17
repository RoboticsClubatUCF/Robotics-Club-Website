import {
	DISCORD_BOT_TOKEN,
	DISCORD_GUILD_ID,
	DISCORD_MEMBER_ROLE_ID,
	DISCORD_PROJECT_LEAD_ROLE_ID,
	DISCORD_TEAM_LEAD_ROLE_ID
} from '$env/static/private';

const API = 'https://discord.com/api/v10';

type Result = { success: boolean; error?: string };

async function discordFetch(
	url: string,
	options: RequestInit,
	fetchFn: typeof fetch,
	retries = 3
): Promise<Response> {
	let lastRes: Response | null = null;
	for (let i = 0; i < retries; i++) {
		lastRes = await fetchFn(url, options);
		if (lastRes.status === 429) {
			const retryAfter = Number(lastRes.headers.get('Retry-After') ?? (i + 1) * 2);
			await new Promise((r) => setTimeout(r, retryAfter * 1000));
			continue;
		}
		return lastRes;
	}
	return lastRes!;
}

async function findGuildMember(
	discordUserName: string,
	headers: Record<string, string>,
	fetchFn: typeof fetch
): Promise<{ id: string } | null> {
	const res = await discordFetch(
		`${API}/guilds/${DISCORD_GUILD_ID}/members/search?query=${encodeURIComponent(discordUserName)}&limit=10`,
		{ headers },
		fetchFn
	);
	if (!res.ok) return null;
	const members: Array<{ user: { id: string; username: string } }> = await res.json();
	return (
		members.find((m) => m.user.username.toLowerCase() === discordUserName.toLowerCase())?.user ??
		null
	);
}

const DISCORD_ROLE_MAP: Array<{ name: string; id: string }> = [
	{ name: 'member',       id: DISCORD_MEMBER_ROLE_ID       },
	{ name: 'project lead', id: DISCORD_PROJECT_LEAD_ROLE_ID },
	{ name: 'team lead',    id: DISCORD_TEAM_LEAD_ROLE_ID    }
].filter((entry) => entry.id.length > 0);

export async function syncMemberRoles(
	discordUserName: string,
	activeRoleNames: string[],
	fetchFn: typeof fetch = globalThis.fetch
): Promise<Result> {
	if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) {
		return { success: false, error: 'Discord bot not configured' };
	}

	const headers = {
		Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
		'Content-Type': 'application/json'
	};

	const user = await findGuildMember(discordUserName, headers, fetchFn);
	if (!user) return { success: true };

	for (const { name, id } of DISCORD_ROLE_MAP) {
		const shouldHave = activeRoleNames.includes(name);
		const res = await discordFetch(
			`${API}/guilds/${DISCORD_GUILD_ID}/members/${user.id}/roles/${id}`,
			{
				method: shouldHave ? 'PUT' : 'DELETE',
				headers: {
					...headers,
					'X-Audit-Log-Reason': shouldHave
						? 'Role assigned via RCCF website'
						: 'Role removed via RCCF website'
				}
			},
			fetchFn
		);
		if (!res.ok && res.status !== 204) {
			console.error(
				`[Discord sync] Failed to ${shouldHave ? 'assign' : 'remove'} role "${name}": ${res.status}`
			);
		}
		await new Promise((r) => setTimeout(r, 300));
	}

	return { success: true };
}

export async function assignMemberRole(
	discordUserName: string,
	fetchFn: typeof fetch = globalThis.fetch
): Promise<Result> {
	if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID || !DISCORD_MEMBER_ROLE_ID) {
		return { success: false, error: 'Discord bot not configured' };
	}

	const headers = {
		Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
		'Content-Type': 'application/json'
	};

	const user = await findGuildMember(discordUserName, headers, fetchFn);
	if (!user) {
		return { success: false, error: `"${discordUserName}" not found in Discord server` };
	}

	const roleRes = await discordFetch(
		`${API}/guilds/${DISCORD_GUILD_ID}/members/${user.id}/roles/${DISCORD_MEMBER_ROLE_ID}`,
		{
			method: 'PUT',
			headers: { ...headers, 'X-Audit-Log-Reason': 'Membership activated via RCCF website' }
		},
		fetchFn
	);

	if (!roleRes.ok && roleRes.status !== 204) {
		return { success: false, error: `Failed to assign role: ${roleRes.status}` };
	}

	return { success: true };
}

export async function assignProjectRole(
	discordUserName: string,
	discordRoleId: string,
	fetchFn: typeof fetch = globalThis.fetch
): Promise<Result> {
	if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) {
		return { success: false, error: 'Discord bot not configured' };
	}

	const headers = {
		Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
		'Content-Type': 'application/json'
	};

	const user = await findGuildMember(discordUserName, headers, fetchFn);
	if (!user) return { success: true };

	const res = await discordFetch(
		`${API}/guilds/${DISCORD_GUILD_ID}/members/${user.id}/roles/${discordRoleId}`,
		{
			method: 'PUT',
			headers: { ...headers, 'X-Audit-Log-Reason': 'Project joined via RCCF website' }
		},
		fetchFn
	);

	if (!res.ok && res.status !== 204) {
		return { success: false, error: `Failed to assign project role: ${res.status}` };
	}
	return { success: true };
}

export async function removeProjectRole(
	discordUserName: string,
	discordRoleId: string,
	fetchFn: typeof fetch = globalThis.fetch
): Promise<Result> {
	if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) {
		return { success: false, error: 'Discord bot not configured' };
	}

	const headers = {
		Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
		'Content-Type': 'application/json'
	};

	const user = await findGuildMember(discordUserName, headers, fetchFn);
	if (!user) return { success: true };

	const res = await discordFetch(
		`${API}/guilds/${DISCORD_GUILD_ID}/members/${user.id}/roles/${discordRoleId}`,
		{
			method: 'DELETE',
			headers: { ...headers, 'X-Audit-Log-Reason': 'Project left via RCCF website' }
		},
		fetchFn
	);

	if (!res.ok && res.status !== 204) {
		return { success: false, error: `Failed to remove project role: ${res.status}` };
	}
	return { success: true };
}

export async function removeMemberRole(
	discordUserName: string,
	fetchFn: typeof fetch = globalThis.fetch
): Promise<Result> {
	if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID || !DISCORD_MEMBER_ROLE_ID) {
		return { success: false, error: 'Discord bot not configured' };
	}

	const headers = {
		Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
		'Content-Type': 'application/json'
	};

	const user = await findGuildMember(discordUserName, headers, fetchFn);
	if (!user) return { success: true };

	const roleRes = await discordFetch(
		`${API}/guilds/${DISCORD_GUILD_ID}/members/${user.id}/roles/${DISCORD_MEMBER_ROLE_ID}`,
		{
			method: 'DELETE',
			headers: { ...headers, 'X-Audit-Log-Reason': 'Membership expired via RCCF website' }
		},
		fetchFn
	);

	if (!roleRes.ok && roleRes.status !== 204) {
		return { success: false, error: `Failed to remove role: ${roleRes.status}` };
	}

	return { success: true };
}
