import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { runReminderJob, CHASE_COOLDOWN_HOURS } from "./reminders";
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

async function tenantWithOwner(name = "Test Co") {
  const tenant = await db.tenant.create({
    data: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-") },
  });
  const owner = await db.internalUser.create({
    data: {
      tenantId: tenant.id,
      email: "owner@test.co",
      passwordHash: "x",
      name: "Owner",
      role: "OWNER",
    },
  });
  return { tenant, owner };
}

describe("runReminderJob", () => {
  it("does not chase somebody who has left", async () => {
    // The mirror of the inactive-supplier-contact skip below it. A reminder
    // addressed to a departed employee is how a chase silently stops working
    // while the board keeps looking fine to everyone still here — and after
    // Phase 3 a directory can deactivate somebody at any hour without anyone
    // on this side noticing.
    const { tenant, owner } = await tenantWithOwner("Departed Co");
    await db.actionItem.create({
      data: {
        tenantId: tenant.id,
        subjectType: "PURCHASE_ORDER",
        subjectId: "po-departed",
        actionType: "PO_REVIEW_REJECTION",
        ownerType: "INTERNAL_USER",
        internalOwnerId: owner.id,
        accessToken: `departed-${Math.random().toString(36).slice(2)}`,
      },
    });
    await db.internalUser.update({ where: { id: owner.id }, data: { status: "DEACTIVATED" } });

    const sender = new RecordingEmailSender();
    const result = await runReminderJob({
      db,
      sender,
      baseUrl: "http://test.local",
      tenantId: tenant.id,
    });

    expect(result.internalEmailsSent).toBe(0);
    // And it is not resolved or reassigned either: a chase click must not
    // silently rewrite the board. Handing the work over is deactivation's
    // job (src/lib/offboarding.ts), which is where it can be seen happening.
    const item = await db.actionItem.findFirst({ where: { subjectId: "po-departed" } });
    expect(item?.status).toBe("OPEN");
    expect(item?.internalOwnerId).toBe(owner.id);
  });

  it("sends one digest per internal owner covering all their open items", async () => {
    const { tenant, owner } = await tenantWithOwner();
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

    expect(result.internalEmailsSent).toBe(1);
    expect(result.externalEmailsSent).toBe(0);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].to).toBe("owner@test.co");
    expect(sender.sent[0].text).toContain("http://test.local/dashboard");
    expect(sender.sent[0].subject).toContain("2 open items");
  });

  it("sends external digests with a per-item scoped link, grouped by contact", async () => {
    const { tenant } = await tenantWithOwner();
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

    expect(result.externalEmailsSent).toBe(1);
    expect(sender.sent[0].to).toBe("sam@supplier.test");
    expect(sender.sent[0].text).toContain("http://test.local/a/external-tok");
    // The buyer's name leads the From line — suppliers ignore automation from
    // vendors they've never heard of, and answer people they buy from.
    expect(sender.sent[0].fromName).toBe("Test Co via ZenoSource");
    expect(sender.sent[0].replyTo).toBe("owner@test.co");
    expect(sender.sent[0].html).toBeTruthy();
  });

  it("skips resolved action items", async () => {
    const { tenant, owner } = await tenantWithOwner();
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

    expect(result.internalEmailsSent).toBe(0);
    expect(result.externalEmailsSent).toBe(0);
    expect(sender.sent).toHaveLength(0);
  });

  // The guard that matters most on the most-distributed surface we own: two
  // people clicking `Chase all` in the same afternoon must not send a supplier
  // the same request twice. A UI-only cooldown is one hard refresh from gone,
  // so it lives in the query.
  it("does not re-chase an item inside the cooldown window", async () => {
    const { tenant } = await tenantWithOwner();
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
        accessToken: "cooldown-tok",
      },
    });

    const first = new RecordingEmailSender();
    const firstRun = await runReminderJob({ db, sender: first, baseUrl: "http://test.local" });
    expect(firstRun.externalEmailsSent).toBe(1);

    const second = new RecordingEmailSender();
    const secondRun = await runReminderJob({ db, sender: second, baseUrl: "http://test.local" });
    expect(secondRun.externalEmailsSent).toBe(0);
    expect(secondRun.skippedByCooldown).toBe(1);
    expect(second.sent).toHaveLength(0);

    // Past the window, it chases again.
    const later = new Date(Date.now() + (CHASE_COOLDOWN_HOURS + 1) * 3_600_000);
    const third = new RecordingEmailSender();
    const thirdRun = await runReminderJob({
      db,
      sender: third,
      baseUrl: "http://test.local",
      now: later,
    });
    expect(thirdRun.externalEmailsSent).toBe(1);
  });

  it("records the chase on each item it sends", async () => {
    const { tenant } = await tenantWithOwner();
    const supplier = await db.supplier.create({ data: { tenantId: tenant.id, name: "Acme Parts" } });
    const contact = await db.supplierContact.create({
      data: { supplierId: supplier.id, name: "Sam", email: "sam@supplier.test" },
    });
    const item = await db.actionItem.create({
      data: {
        tenantId: tenant.id,
        subjectType: "PURCHASE_ORDER",
        subjectId: "po-1",
        actionType: "PO_ACKNOWLEDGE",
        ownerType: "EXTERNAL_USER",
        externalOwnerId: contact.id,
        accessToken: "counted-tok",
      },
    });

    await runReminderJob({ db, sender: new RecordingEmailSender(), baseUrl: "http://test.local" });

    const after = await db.actionItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.reminderCount).toBe(1);
    expect(after.lastRemindedAt).toBeTruthy();
  });

  // A reminder addressed to somebody who left the supplier is how a chase
  // silently stops working while the board still looks fine on our side.
  it("does not chase a deactivated contact", async () => {
    const { tenant } = await tenantWithOwner();
    const supplier = await db.supplier.create({ data: { tenantId: tenant.id, name: "Acme Parts" } });
    const contact = await db.supplierContact.create({
      data: {
        supplierId: supplier.id,
        name: "Departed",
        email: "gone@supplier.test",
        status: "INACTIVE",
      },
    });
    await db.actionItem.create({
      data: {
        tenantId: tenant.id,
        subjectType: "PURCHASE_ORDER",
        subjectId: "po-1",
        actionType: "PO_ACKNOWLEDGE",
        ownerType: "EXTERNAL_USER",
        externalOwnerId: contact.id,
        accessToken: "inactive-tok",
      },
    });

    const sender = new RecordingEmailSender();
    const result = await runReminderJob({ db, sender, baseUrl: "http://test.local" });

    expect(result.externalEmailsSent).toBe(0);
    expect(sender.sent).toHaveLength(0);
  });

  it("scopes to one tenant when asked, for the Chase all button", async () => {
    const a = await tenantWithOwner("Tenant A");
    const b = await db.tenant.create({ data: { name: "Tenant B", slug: "reminders-tenant-b" } });
    const bOwner = await db.internalUser.create({
      data: { tenantId: b.id, email: "b@test.co", passwordHash: "x", name: "B Owner" },
    });

    for (const [tenantId, ownerId, token] of [
      [a.tenant.id, a.owner.id, "a-tok"],
      [b.id, bOwner.id, "b-tok"],
    ] as const) {
      await db.actionItem.create({
        data: {
          tenantId,
          subjectType: "PURCHASE_ORDER",
          subjectId: "po-1",
          actionType: "PO_REVIEW_REJECTION",
          ownerType: "INTERNAL_USER",
          internalOwnerId: ownerId,
          accessToken: token,
        },
      });
    }

    const sender = new RecordingEmailSender();
    const result = await runReminderJob({
      db,
      sender,
      baseUrl: "http://test.local",
      tenantId: a.tenant.id,
    });

    expect(result.internalEmailsSent).toBe(1);
    expect(sender.sent[0].to).toBe("owner@test.co");
  });
});
