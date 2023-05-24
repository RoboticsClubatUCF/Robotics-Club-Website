import { hashSync } from 'bcrypt';

export default function generatePassword(pass: string): string {
	return hashSync(pass, 12);
}
