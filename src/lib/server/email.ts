import { POSTMARK_API_TOKEN } from '$env/static/private';
import postmark from 'postmark';

export function getEmailClient(): postmark.ServerClient {
	if (!POSTMARK_API_TOKEN) {
		throw new Error('POSTMARK_API_TOKEN is required to send email');
	}

	return new postmark.ServerClient(POSTMARK_API_TOKEN);
}
