export const ROLES = {
	guest: { name: 'guest', level: 0 },
	member: { name: 'member', level: 4 },
	teamLead: { name: 'team lead', level: 6 },
	projectLead: { name: 'project lead', level: 8 },
	officer: { name: 'officer', level: 10 },
	admin: { name: 'admin', level: 999 }
} as const;

export const DUES = { semester: 20, year: 30 } as const; // USD
