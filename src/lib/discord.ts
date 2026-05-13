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
  fetchFn: typeof fetch
): Promise<Response> {
  const res = await fetchFn(url, options);
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') ?? 1);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return fetchFn(url, options);
  }
  return res;
}

async function findGuildMember(
  discordUsername: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch
): Promise<{ id: string } | null> {
  const res = await discordFetch(
    `${API}/guilds/${DISCORD_GUILD_ID}/members/search?query=${encodeURIComponent(discordUsername)}&limit=10`,
    { headers },
    fetchFn
  );
  if (!res.ok) return null;
  const members: Array<{ user: { id: string; username: string } }> = await res.json();
  return members.find(
    (m) => m.user.username.toLowerCase() === discordUsername.toLowerCase()
  )?.user ?? null;
}

// Maps DB role names to Discord role IDs (skips unconfigured entries)
// Officer role is intentionally excluded — the bot lacks permission to assign it on Discord.
// Officer assignment is DB-only; the role is managed manually on the Discord server.
const DISCORD_ROLE_MAP: Array<{ name: string; id: string }> = [
  { name: 'member', id: DISCORD_MEMBER_ROLE_ID },
  { name: 'project lead', id: DISCORD_PROJECT_LEAD_ROLE_ID },
  { name: 'team lead', id: DISCORD_TEAM_LEAD_ROLE_ID }
].filter((entry) => entry.id.length > 0);

/**
 * Syncs a member's full Discord role set. Assigns roles in activeRoleNames,
 * removes all other managed roles. Safe to call when member leaves server.
 */
export async function syncMemberRoles(
  discordUsername: string,
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

  const user = await findGuildMember(discordUsername, headers, fetchFn);
  if (!user) {
    // Not in server — no Discord state to manage
    return { success: true };
  }

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
      console.error(`[Discord sync] Failed to ${shouldHave ? 'assign' : 'remove'} role "${name}": ${res.status}`);
    }
    // Brief pause between role operations to stay within rate limits
    await new Promise((r) => setTimeout(r, 300));
  }

  return { success: true };
}

export async function assignMemberRole(
  discordUsername: string,
  fetchFn: typeof fetch = globalThis.fetch
): Promise<Result> {
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID || !DISCORD_MEMBER_ROLE_ID) {
    return { success: false, error: 'Discord bot not configured' };
  }

  const headers = {
    Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json'
  };

  const user = await findGuildMember(discordUsername, headers, fetchFn);
  if (!user) {
    return { success: false, error: `"${discordUsername}" not found in Discord server` };
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
  discordUsername: string,
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

  const user = await findGuildMember(discordUsername, headers, fetchFn);
  if (!user) return { success: true }; // not in server — no-op

  const res = await discordFetch(
    `${API}/guilds/${DISCORD_GUILD_ID}/members/${user.id}/roles/${discordRoleId}`,
    { method: 'PUT', headers: { ...headers, 'X-Audit-Log-Reason': 'Project joined via RCCF website' } },
    fetchFn
  );

  if (!res.ok && res.status !== 204) {
    return { success: false, error: `Failed to assign project role: ${res.status}` };
  }
  return { success: true };
}

export async function removeProjectRole(
  discordUsername: string,
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

  const user = await findGuildMember(discordUsername, headers, fetchFn);
  if (!user) return { success: true }; // not in server — no-op

  const res = await discordFetch(
    `${API}/guilds/${DISCORD_GUILD_ID}/members/${user.id}/roles/${discordRoleId}`,
    { method: 'DELETE', headers: { ...headers, 'X-Audit-Log-Reason': 'Project left via RCCF website' } },
    fetchFn
  );

  if (!res.ok && res.status !== 204) {
    return { success: false, error: `Failed to remove project role: ${res.status}` };
  }
  return { success: true };
}

export async function removeMemberRole(
  discordUsername: string,
  fetchFn: typeof fetch = globalThis.fetch
): Promise<Result> {
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID || !DISCORD_MEMBER_ROLE_ID) {
    return { success: false, error: 'Discord bot not configured' };
  }

  const headers = {
    Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json'
  };

  const user = await findGuildMember(discordUsername, headers, fetchFn);
  if (!user) {
    // User may have left the server — role is already gone, treat as success
    return { success: true };
  }

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
