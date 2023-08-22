import { appendFileSync, writeFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

main();

async function main()  {
const users = await prisma.member.findMany({});
const csv = [];
csv.push("id,","firstname,","email,","discordName,","membershipEXPDate,");

console.log('Logging Members Table to file');
writeFileSync(
  './MEMBERS' + new Date().toDateString() + '.csv',
  "id,"+"firstname,"+"email,"+"discordName,"+"membershipEXPDate\n"
);
for(const u of users){
  appendFileSync(
    './MEMBERS' + new Date().toDateString() + '.csv',
    u.id.toString() + "," + u.firstName + "," + u.email + "," + u.discordProfileName + "," + u.membershipExpDate.toDateString() + "\n"
  )
}
}
