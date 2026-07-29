import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getEmailSender, isMailboxActive, MailboxEmailSender } from "./sender";
import { runReminderJob } from "@/lib/reminders";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes("zenosource_test")) {
    throw new Error("Refusing to run — DATABASE_URL doesn't point at the test database.");
  }
});

afterAll(async () => {
  await db.$disconnect();
});

// Only CapturedEmail needs cleaning here — this file creates its reminder
// fixtures with per-run unique values instead of wiping the shared test DB,
// and filters its assertions accordingly. Unique-per-run matters: ActionItem
// accessToken is globally @unique, so a fixed literal would make any isolated
// re-run of just this file (test:watch, filtered vitest run) fail with P2002.
const runId = Math.random().toString(36).slice(2);
const contactEmail = `pat-${runId}@mailbox-test.example`;
const fixtureToken = `mailbox-test-token-${runId}`;

beforeEach(async () => {
  await db.capturedEmail.deleteMany();
});

describe("getEmailSender", () => {
  it("returns the mailbox sender while no provider is configured", () => {
    delete process.env.EMAIL_PROVIDER;
    expect(isMailboxActive()).toBe(true);
    expect(getEmailSender(db)).toBeInstanceOf(MailboxEmailSender);
  });

  it("refuses a configured provider nothing implements", () => {
    process.env.EMAIL_PROVIDER = "postmark";
    try {
      expect(isMailboxActive()).toBe(false);
      expect(() => getEmailSender(db)).toThrow(/postmark/);
    } finally {
      delete process.env.EMAIL_PROVIDER;
    }
  });
});

describe("MailboxEmailSender", () => {
  it("captures messages to the database instead of delivering them", async () => {
    const sender = new MailboxEmailSender(db);
    await sender.send({ to: "someone@example.test", subject: "Hello", text: "Body text" });

    const captured = await db.capturedEmail.findMany();
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      toEmail: "someone@example.test",
      subject: "Hello",
      textBody: "Body text",
    });
  });

  it("captures reminder digests, action links included", async () => {
    const tenant = await db.tenant.create({ data: { name: "Mailbox Test Co" } });
    const supplier = await db.supplier.create({
      data: { tenantId: tenant.id, name: "Mailbox Test Supplier" },
    });
    const contact = await db.supplierContact.create({
      data: { supplierId: supplier.id, name: "Pat", email: contactEmail },
    });
    await db.actionItem.create({
      data: {
        tenantId: tenant.id,
        subjectType: "PURCHASE_ORDER",
        subjectId: "po-mailbox-test",
        actionType: "PO_ACKNOWLEDGE",
        ownerType: "EXTERNAL_USER",
        externalOwnerId: contact.id,
        accessToken: fixtureToken,
      },
    });

    await runReminderJob({
      db,
      sender: new MailboxEmailSender(db),
      baseUrl: "http://test.local",
    });

    // The shared test DB can hold open items from other suites, so assert on
    // this test's digest specifically rather than on totals.
    const digest = await db.capturedEmail.findFirst({
      where: { toEmail: contactEmail },
    });
    expect(digest).not.toBeNull();
    expect(digest!.textBody).toContain(`http://test.local/a/${fixtureToken}`);
    expect(digest!.subject).toContain("Mailbox Test Co");
  });
});
