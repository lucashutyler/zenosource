import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { runReminderJob } from "../src/lib/reminders";
import { getEmailSender } from "../src/lib/email/sender";

// External entrypoint for the daily reminder job — invoke this from
// whatever scheduler you end up with (cron, GitHub Actions on a schedule,
// a hosting platform's cron), since none is chosen yet (docs/todo.md).
// `npm run send-reminders` runs it on demand in the meantime.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";

runReminderJob({ db, sender: getEmailSender(), baseUrl })
  .then(({ internalEmailsSent, externalEmailsSent }) => {
    console.log(
      `Reminder job complete: ${internalEmailsSent} internal digest(s), ${externalEmailsSent} external digest(s).`
    );
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
