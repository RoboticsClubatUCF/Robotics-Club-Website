import { env } from '$env/dynamic/private';

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
	guildId: string,
	headers: Record<string, string>,
	fetchFn: typeof fetch
): Promise<{ id: string } | null> {
	const res = await discordFetch(
		`${API}/guilds/${guildId}/members/search?query=${encodeURIComponent(discordUserName)}&limit=10`,
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

function getDiscordRoleMap(): Array<{ name: string; id: string }> {
	return [
		{ name: 'member', id: env.DISCORD_MEMBER_ROLE_ID },
		{ name: 'project lead', id: env.DISCORD_PROJECT_LEAD_ROLE_ID },
		{ name: 'team lead', id: env.DISCORD_TEAM_LEAD_ROLE_ID }
	].filter((entry): entry is { name: string; id: string } => !!entry.id);
}

export async function isGuildMember(
	discordUserName: string,
	fetchFn: typeof fetch = globalThis.fetch
): Promise<{ found: boolean; configured: boolean }> {
	if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) {
		return { found: false, configured: false };
	}
	const headers = { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` };
	const user = await findGuildMember(discordUserName, env.DISCORD_GUILD_ID, headers, fetchFn);
	return { found: user !== null, configured: true };
}

export async function syncMemberRoles(
	discordUserName: string,
	activeRoleNames: string[],
	fetchFn: typeof fetch = globalThis.fetch
): Promise<Result> {
	if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) {
		return { success: false, error: 'Discord bot not configured' };
	}

	const headers = {
		Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
		'Content-Type': 'application/json'
	};

	const user = await findGuildMember(discordUserName, env.DISCORD_GUILD_ID, headers, fetchFn);
	if (!user) return { success: true };

	for (const { name, id } of getDiscordRoleMap()) {
		const shouldHave = activeRoleNames.includes(name);
		const res = await discordFetch(
			`${API}/guilds/${env.DISCORD_GUILD_ID}/members/${user.id}/roles/${id}`,
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
	if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID || !env.DISCORD_MEMBER_ROLE_ID) {
		return { success: false, error: 'Discord bot not configured' };
	}

	const headers = {
		Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
		'Content-Type': 'application/json'
	};

	const user = await findGuildMember(discordUserName, env.DISCORD_GUILD_ID, headers, fetchFn);
	if (!user) {
		return { success: false, error: `"${discordUserName}" not found in Discord server` };
	}

	const roleRes = await discordFetch(
		`${API}/guilds/${env.DISCORD_GUILD_ID}/members/${user.id}/roles/${env.DISCORD_MEMBER_ROLE_ID}`,
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
	if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) {
		return { success: false, error: 'Discord bot not configured' };
	}

	const headers = {
		Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
		'Content-Type': 'application/json'
	};

	const user = await findGuildMember(discordUserName, env.DISCORD_GUILD_ID, headers, fetchFn);
	if (!user) return { success: true };

	const res = await discordFetch(
		`${API}/guilds/${env.DISCORD_GUILD_ID}/members/${user.id}/roles/${discordRoleId}`,
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
	if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) {
		return { success: false, error: 'Discord bot not configured' };
	}

	const headers = {
		Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
		'Content-Type': 'application/json'
	};

	const user = await findGuildMember(discordUserName, env.DISCORD_GUILD_ID, headers, fetchFn);
	if (!user) return { success: true };

	const res = await discordFetch(
		`${API}/guilds/${env.DISCORD_GUILD_ID}/members/${user.id}/roles/${discordRoleId}`,
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
	if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID || !env.DISCORD_MEMBER_ROLE_ID) {
		return { success: false, error: 'Discord bot not configured' };
	}

	const headers = {
		Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
		'Content-Type': 'application/json'
	};

	const user = await findGuildMember(discordUserName, env.DISCORD_GUILD_ID, headers, fetchFn);
	if (!user) return { success: true };

	const roleRes = await discordFetch(
		`${API}/guilds/${env.DISCORD_GUILD_ID}/members/${user.id}/roles/${env.DISCORD_MEMBER_ROLE_ID}`,
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
