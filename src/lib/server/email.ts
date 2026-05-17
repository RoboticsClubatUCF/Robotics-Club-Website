import { env } from '$env/dynamic/private';
import postmark from 'postmark';

export function getEmailClient(): postmark.ServerClient {
	if (!env.POSTMARK_API_TOKEN) {
		throw new Error('POSTMARK_API_TOKEN is required to send email');
	}

	return new postmark.ServerClient(env.POSTMARK_API_TOKEN);
}
