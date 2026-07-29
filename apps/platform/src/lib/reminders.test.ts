import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { runReminderJob } from "./reminders";
import type { EmailSender, EmailMessage } from "@/lib/email/sender";
import { wipeTestDb } from "@/lib/testing/wipe-test-db";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

class RecordingEmailSender implements EmailSender {
  sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
  }
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes("zenosource_test")) {
    throw new Error("Refusing to run — DATABASE_URL doesn't point at the test database.");
  }
});

afterAll(async () => {
  await db.$disconnect();
});

// The test DB is shared with the E2E suite (see e2e/global-setup.ts) and
// with every other Vitest file, so this needs to clean every table any of
// them could have populated, not just the ones this file itself uses — see
// src/lib/testing/wipe-test-db.ts.
beforeEach(() => wipeTestDb(db));

describe("runReminderJob", () => {
  it("sends one digest per internal owner covering all their open items", async () => {
    const tenant = await db.tenant.create({ data: { name: "Test Co" } });
    const owner = await db.internalUser.create({
      data: { tenantId: tenant.id, email: "owner@test.co", passwordHash: "x", name: "Owner" },
    });
    await db.actionItem.createMany({
      data: [
        {
          tenantId: tenant.id,
          subjectType: "PURCHASE_ORDER",
          subjectId: "po-1",
          actionType: "PO_REVIEW_REJECTION",
          ownerType: "INTERNAL_USER",
          internalOwnerId: owner.id,
          accessToken: "tok-1",
        },
        {
          tenantId: tenant.id,
          subjectType: "PURCHASE_ORDER_LINE",
          subjectId: "line-1",
          actionType: "PO_REVIEW_CHANGE_PROPOSAL",
          ownerType: "INTERNAL_USER",
          internalOwnerId: owner.id,
          accessToken: "tok-2",
        },
      ],
    });

    const sender = new RecordingEmailSender();
    const result = await runReminderJob({ db, sender, baseUrl: "http://test.local" });

    expect(result).toEqual({ internalEmailsSent: 1, externalEmailsSent: 0 });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].to).toBe("owner@test.co");
    expect(sender.sent[0].text).toContain("http://test.local/dashboard");
    expect(sender.sent[0].subject).toContain("2 open items");
  });

  it("sends external digests with a per-item scoped link, grouped by contact", async () => {
    const tenant = await db.tenant.create({ data: { name: "Test Co" } });
    const supplier = await db.supplier.create({ data: { tenantId: tenant.id, name: "Acme Parts" } });
    const contact = await db.supplierContact.create({
      data: { supplierId: supplier.id, name: "Sam", email: "sam@supplier.test" },
    });
    await db.actionItem.create({
      data: {
        tenantId: tenant.id,
        subjectType: "PURCHASE_ORDER",
        subjectId: "po-1",
        actionType: "PO_ACKNOWLEDGE",
        ownerType: "EXTERNAL_USER",
        externalOwnerId: contact.id,
        accessToken: "external-tok",
      },
    });

    const sender = new RecordingEmailSender();
    const result = await runReminderJob({ db, sender, baseUrl: "http://test.local" });

    expect(result).toEqual({ internalEmailsSent: 0, externalEmailsSent: 1 });
    expect(sender.sent[0].to).toBe("sam@supplier.test");
    expect(sender.sent[0].text).toContain("http://test.local/a/external-tok");
    expect(sender.sent[0].subject).toContain("Test Co");
  });

  it("skips resolved action items", async () => {
    const tenant = await db.tenant.create({ data: { name: "Test Co" } });
    const owner = await db.internalUser.create({
      data: { tenantId: tenant.id, email: "owner@test.co", passwordHash: "x", name: "Owner" },
    });
    await db.actionItem.create({
      data: {
        tenantId: tenant.id,
        subjectType: "PURCHASE_ORDER",
        subjectId: "po-1",
        actionType: "PO_REVIEW_REJECTION",
        ownerType: "INTERNAL_USER",
        internalOwnerId: owner.id,
        accessToken: "tok-resolved",
        status: "RESOLVED",
        resolvedAt: new Date(),
      },
    });

    const sender = new RecordingEmailSender();
    const result = await runReminderJob({ db, sender, baseUrl: "http://test.local" });

    expect(result).toEqual({ internalEmailsSent: 0, externalEmailsSent: 0 });
    expect(sender.sent).toHaveLength(0);
  });
});
