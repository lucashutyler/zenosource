import { test, expect } from "@playwright/test";
import {
  findOpenActionItem,
  findActionItemById,
  findPurchaseOrderById,
  findPurchaseOrderLineById,
  createTestAcknowledgeItem,
} from "./helpers/db";

test("supplier can confirm a PO via the no-login link, and reopening it afterwards says so kindly", async ({
  browser,
}) => {
  const item = await findOpenActionItem("PO_ACKNOWLEDGE");
  const po = await findPurchaseOrderById(item.subjectId);

  const ctx1 = await browser.newContext();
  const page1 = await ctx1.newPage();
  await page1.goto(`/a/${item.accessToken}`);

  // Leads with the buyer and the document number, not the recipient's own
  // name — a supplier has to be able to tell which order this is.
  await expect(page1.getByText("Acme Manufacturing (demo)").first()).toBeVisible();
  await expect(page1.getByText(po.number).first()).toBeVisible();

  await page1.getByRole("button", { name: /^Confirm/ }).click();
  await expect(page1.getByText("Confirmed.")).toBeVisible();
  // The receipt is written in the third person, because it gets forwarded.
  await expect(page1.getByText(/Your company confirmed/)).toBeVisible();
  await ctx1.close();

  // Reopening the same link afterward — the exact scenario the atomic
  // tryResolveActionItem guard exists for. The copy must not tell somebody
  // who just succeeded to go and ask for a new link.
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto(`/a/${item.accessToken}`);
  await expect(page2.getByText("Nothing left to do here.")).toBeVisible();
  await expect(page2.getByText(/resend/i)).toHaveCount(0);
  await ctx2.close();

  const resolved = await findActionItemById(item.id);
  expect(resolved.status).toBe("RESOLVED");
  expect(resolved.resolvedByContactId).toBeTruthy();
});

test("confirming records a promise date, so on-time delivery has something to measure", async ({
  page,
}) => {
  const item = await createTestAcknowledgeItem();

  await page.goto(`/a/${item.accessToken}`);
  await page.getByRole("button", { name: /^Confirm/ }).click();
  await expect(page.getByText("Confirmed.")).toBeVisible();

  // docs/data-model.md says promise_date is "set once acknowledged" — the old
  // form never asked, so the happy path left it null forever and every
  // on-time metric had nothing to measure against.
  const line = await findPurchaseOrderLineById(`${item.subjectId}-line`);
  expect(line.status).toBe("ACKNOWLEDGED");
  expect(line.promiseDate).toBeTruthy();
});

test("two concurrent confirm attempts on the same link only resolve once", async ({ browser }) => {
  // A fresh item of its own — the seed's PO_ACKNOWLEDGE items may already
  // have been resolved by another test in this run.
  const item = await createTestAcknowledgeItem();

  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()]);
  const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);

  await Promise.all([pageA.goto(`/a/${item.accessToken}`), pageB.goto(`/a/${item.accessToken}`)]);

  async function clickAndWaitForOutcome(page: typeof pageA) {
    await page.getByRole("button", { name: /^Confirm/ }).click();
    await page
      .getByText("Confirmed.")
      .or(page.getByText("already resolved"))
      .waitFor({ state: "visible" });
    return (await page.textContent("body")) ?? "";
  }

  const [resultA, resultB] = await Promise.all([
    clickAndWaitForOutcome(pageA),
    clickAndWaitForOutcome(pageB),
  ]);

  const outcomes = [resultA, resultB].map((text) =>
    text.includes("Confirmed.") ? "resolved" : "already-handled"
  );
  expect(outcomes.filter((o) => o === "resolved")).toHaveLength(1);
  expect(outcomes.filter((o) => o === "already-handled")).toHaveLength(1);

  await ctxA.close();
  await ctxB.close();

  const po = await findPurchaseOrderById(item.subjectId);
  expect(po.status).toBe("ACKNOWLEDGED"); // not double-processed into some other state
});

// The collaboration feature the product is effectively named for. The
// `proposed*` columns and the buyer's accept/reject screen both shipped in
// Phase 1 with no way for a supplier to ever produce a proposal, so the whole
// exchange was unreachable from the side that starts it.
test("supplier can counter-propose instead of only accepting or refusing", async ({ page }) => {
  const item = await createTestAcknowledgeItem();
  const lineId = `${item.subjectId}-line`;

  await page.goto(`/a/${item.accessToken}`);
  await page.getByRole("button", { name: "I can do it, but not like this" }).click();

  await page.fill(`input[name="proposed-quantity-${lineId}"]`, "3");
  await page.fill(`input[name="proposed-price-${lineId}"]`, "1.75");
  await page.getByRole("button", { name: /Send this back/ }).click();

  await expect(page.getByText("Sent back for approval.")).toBeVisible();

  const line = await findPurchaseOrderLineById(lineId);
  expect(line.status).toBe("CHANGE_PROPOSED");
  expect(Number(line.proposedQuantity)).toBe(3);
  expect(Number(line.proposedUnitPrice)).toBe(1.75);
});

test("a supplier can turn an order down with a reason", async ({ page }) => {
  const item = await createTestAcknowledgeItem();

  await page.goto(`/a/${item.accessToken}`);
  await page.getByRole("button", { name: "I can't take this order" }).click();
  await page.fill('textarea[name="reason"]', "Line is down for retooling until October.");
  await page.getByRole("button", { name: "Turn the order down" }).click();

  await expect(page.getByText("Turned down.")).toBeVisible();

  const po = await findPurchaseOrderById(item.subjectId);
  expect(po.status).toBe("REJECTED");
  expect(po.rejectionReason).toContain("retooling");
});
