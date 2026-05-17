declare global {
	namespace App {
		interface Locals {
			user: {
				id: number;
				firstName: string;
				lastName: string | null;
				ucfEmail: string;
				discordUserName: string;
				role: { name: string; permissionLevel: number; discordRoleId: string | null };
				membershipExpDate: Date;
				hasSurvey: boolean;
			} | null;
		}
	}
}

export {};
