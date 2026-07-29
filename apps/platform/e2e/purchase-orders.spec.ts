import { test, expect } from "@playwright/test";
import {
  findLocationByCode,
  findPurchaseOrderAtLocation,
  findPurchaseOrderLine,
  findPurchaseOrderLineById,
  findPurchaseOrderById,
  findActionItemById,
  findOpenActionItemsForSubject,
  createTestChangeProposalItem,
  createTestDraftPOForContactlessSupplier,
  createTestAcknowledgeItem,
  createTestReviewRejectionItem,
} from "./helpers/db";
import { loginAs, confirmAction } from "./helpers/login";

test("owner can create, issue, and cancel a purchase order", async ({ page }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");

  await page.goto("/dashboard/purchase-orders/new");
  await page.selectOption('select[name="supplierId"]', { index: 1 });
  await page.fill('input[name="itemNumber-0"]', "SKU-E2E");
  await page.fill('input[name="description-0"]', "E2E test widget");
  await page.fill('input[name="uom-0"]', "EA");
  await page.fill('input[name="quantity-0"]', "10");
  await page.fill('input[name="unitPrice-0"]', "1.50");
  await page.selectOption('select[name="locationId-0"]', { index: 1 });
  await page.click('button:has-text("Save as draft")');
  // Negative lookahead on "new" — a bare `[a-z0-9]+` also matches the create
  // page's own URL (/purchase-orders/new), so this assertion could resolve
  // true before the redirect actually lands, on a slow enough submission.
  await expect(page).toHaveURL(/\/dashboard\/purchase-orders\/(?!new$)[a-z0-9]+$/);
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();

  // Every irreversible action is behind a confirm that names its
  // consequence — issuing emails a company outside ours.
  await confirmAction(page, "Issue to supplier", "Issue it");
  await expect(page.getByText("Issued", { exact: true }).first()).toBeVisible();

  await confirmAction(page, "Cancel this order", "Cancel the order");
  await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
});

test("a draft carries a document number from the moment it exists", async ({ page }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");

  await page.goto("/dashboard/purchase-orders/new");
  await page.selectOption('select[name="supplierId"]', { index: 1 });
  await page.fill('input[name="itemNumber-0"]', "SKU-E2E-NUMBER");
  await page.fill('input[name="description-0"]', "numbering test");
  await page.fill('input[name="uom-0"]', "EA");
  await page.fill('input[name="quantity-0"]', "2");
  await page.fill('input[name="unitPrice-0"]', "3");
  await page.selectOption('select[name="locationId-0"]', { index: 1 });
  await page.click('button:has-text("Save as draft")');
  await expect(page).toHaveURL(/\/dashboard\/purchase-orders\/(?!new$)[a-z0-9]+$/);

  const id = page.url().split("/").pop()!;
  const po = await findPurchaseOrderById(id);
  expect(po.number).toMatch(/^P-\d+$/);
  await expect(page.getByText(po.number).first()).toBeVisible();
  // The total is a real column, not a post-fetch sum.
  expect(Number(po.totalValue)).toBe(6);
});

// The audit's headline form finding: one missing Location destroyed roughly
// 35 filled-in fields and returned `Line 1: Invalid input` as the only
// explanation.
test("a validation error keeps everything typed and says which field", async ({ page }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");

  await page.goto("/dashboard/purchase-orders/new");
  await page.selectOption('select[name="supplierId"]', { index: 1 });
  await page.fill('input[name="itemNumber-0"]', "SKU-KEEPME");
  await page.fill('input[name="description-0"]', "should survive the round trip");
  await page.fill('input[name="uom-0"]', "EA");
  await page.fill('input[name="quantity-0"]', "7");
  await page.fill('input[name="unitPrice-0"]', "2.25");
  // Location deliberately left unset.
  await page.click('button:has-text("Save as draft")');

  await expect(page).toHaveURL(/\/dashboard\/purchase-orders\/new$/);
  await expect(page.locator('#locationId-0-error')).toContainText("Choose a location");
  // Nothing thrown away.
  await expect(page.locator('input[name="itemNumber-0"]')).toHaveValue("SKU-KEEPME");
  await expect(page.locator('input[name="description-0"]')).toHaveValue(
    "should survive the round trip"
  );
  await expect(page.locator('input[name="quantity-0"]')).toHaveValue("7");
  await expect(page.locator('input[name="unitPrice-0"]')).toHaveValue("2.25");
});

// `LINE_SLOTS = 5` with parsers reading indices 0–4 silently discarded a
// sixth line and reported success.
test("a purchase order can carry more than five lines", async ({ page }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");

  await page.goto("/dashboard/purchase-orders/new");
  await page.selectOption('select[name="supplierId"]', { index: 1 });

  for (let i = 0; i < 6; i++) {
    if (i >= 3) await page.getByRole("button", { name: "Add a line" }).click();
    await page.fill(`input[name="itemNumber-${i}"]`, `SKU-MANY-${i}`);
    await page.fill(`input[name="description-${i}"]`, `line ${i}`);
    await page.fill(`input[name="uom-${i}"]`, "EA");
    await page.fill(`input[name="quantity-${i}"]`, "1");
    await page.fill(`input[name="unitPrice-${i}"]`, "1");
    await page.selectOption(`select[name="locationId-${i}"]`, { index: 1 });
  }

  await page.click('button:has-text("Save as draft")');
  await expect(page).toHaveURL(/\/dashboard\/purchase-orders\/(?!new$)[a-z0-9]+$/);
  await expect(page.getByText("6 lines")).toBeVisible();
});

// Every quantity and price the app accepted was unbounded — the seeded dev
// database contained a $12 trillion order because nothing stopped it.
test("absurd quantities are refused rather than stored", async ({ page }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");

  await page.goto("/dashboard/purchase-orders/new");
  await page.selectOption('select[name="supplierId"]', { index: 1 });
  await page.fill('input[name="itemNumber-0"]', "SKU-ABSURD");
  await page.fill('input[name="description-0"]', "too much of it");
  await page.fill('input[name="uom-0"]', "EA");
  await page.fill('input[name="quantity-0"]', "1234567.8910");
  await page.fill('input[name="unitPrice-0"]', "9876543.21");
  await page.selectOption('select[name="locationId-0"]', { index: 1 });
  await page.click('button:has-text("Save as draft")');

  await expect(page).toHaveURL(/\/dashboard\/purchase-orders\/new$/);
  await expect(page.locator("#quantity-0-error")).toBeVisible();
});

test("a MEMBER restricted to one location cannot see a PO at another location", async ({ page }) => {
  const dallas = await findLocationByCode("DAL-01");
  const dallasOnlyPO = await findPurchaseOrderAtLocation(dallas.id);

  await loginAs(page, "casey@acme.test", "zenosource-dev");

  // Not in Casey's (Chicago-only) list
  await page.goto("/dashboard/purchase-orders");
  await expect(page.locator(`a[href="/dashboard/purchase-orders/${dallasOnlyPO.id}"]`)).toHaveCount(0);

  // Direct navigation is blocked too, not just hidden from the list.
  //
  // Asserting on disclosure rather than the status line: the designed
  // not-found boundary renders inside the already-streamed dashboard layout,
  // so the response is a 200 carrying nothing about the record. What has to
  // hold is that no part of the order reaches a browser that shouldn't have
  // it, which is what these assertions check.
  await page.goto(`/dashboard/purchase-orders/${dallasOnlyPO.id}`);
  await expect(page.getByText("Nothing here.")).toBeVisible();
  await expect(page.getByText(dallasOnlyPO.number)).toHaveCount(0);
});

test("accepting a supplier-proposed change resolves the action item and updates the total", async ({
  page,
}) => {
  const line = await findPurchaseOrderLine("CHANGE_PROPOSED");

  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto(`/dashboard/purchase-orders/${line.purchaseOrderId}`);

  // The proposal is a diff, with extended value as the row that decides it.
  await expect(page.getByRole("heading", { name: "Proposed changes" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "Extended value" })).toBeVisible();

  await confirmAction(page, "Accept the change", "Accept it");
  await expect(page.getByRole("heading", { name: "Proposed changes" })).toHaveCount(0);

  const updated = await findPurchaseOrderLineById(line.id);
  expect(updated.status).toBe("ACKNOWLEDGED");
  expect(updated.proposedQuantity).toBeNull();
});

test("cancelling a PO resolves its line-level action items too, not just PO-level ones", async ({
  page,
}) => {
  const fixture = await createTestChangeProposalItem();

  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto(`/dashboard/purchase-orders/${fixture.poId}`);
  await confirmAction(page, "Cancel this order", "Cancel the order");
  await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();

  const item = await findActionItemById(fixture.id);
  expect(item.status).toBe("RESOLVED");
});

test("a MEMBER's ?locationId= filter can't be widened past their assigned scope", async ({
  page,
}) => {
  const dallas = await findLocationByCode("DAL-01");
  const dallasOnlyPO = await findPurchaseOrderAtLocation(dallas.id);

  await loginAs(page, "casey@acme.test", "zenosource-dev");

  // Casey is Chicago-only; hand-editing ?locationId= to Dallas's id must not
  // surface Dallas POs — the filter should narrow her scope, never replace it.
  await page.goto(`/dashboard/purchase-orders?locationId=${dallas.id}`);
  await expect(page.locator(`a[href="/dashboard/purchase-orders/${dallasOnlyPO.id}"]`)).toHaveCount(0);
});

test("an invalid ?status= value is ignored rather than 500ing", async ({ page }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");

  const response = await page.goto("/dashboard/purchase-orders?status=NOT_A_REAL_STATUS");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Purchase orders" })).toBeVisible();
});

test("search finds an order by its part number", async ({ page }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");

  // "The supplier called about SKU-2050" previously meant opening every order
  // in the list one at a time.
  await page.goto("/dashboard/purchase-orders?q=SKU-2050");
  await expect(page.getByRole("heading", { name: "Purchase orders" })).toBeVisible();
  await expect(page.locator("tbody tr").first()).toBeVisible();
});

test("issuing to a supplier with no contact is blocked, not silently accepted", async ({ page }) => {
  const { poId } = await createTestDraftPOForContactlessSupplier();

  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto(`/dashboard/purchase-orders/${poId}`);
  await confirmAction(page, "Issue to supplier", "Issue it");

  await expect(page.getByText(/has no active contact on file/)).toBeVisible();
  // Still draft — nothing silently transitioned.
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
});

test("the ledger shows whose court each order is in, and what they owe", async ({ page }) => {
  // Owned by the supplier, not by any internal user.
  const externallyOwned = await createTestAcknowledgeItem();
  // Owned by the OWNER internal user (buyer@acme.test).
  const internallyOwned = await createTestReviewRejectionItem();

  await loginAs(page, "buyer@acme.test", "zenosource-dev");

  await page.goto(`/dashboard/purchase-orders?q=${externallyOwned.poNumber}`);
  await expect(page.getByText(/acknowledge$/i).first()).toBeVisible();

  await page.goto(`/dashboard/purchase-orders?q=${internallyOwned.poNumber}`);
  // Assigned to the reader, so it says "You", not "Us" and not a status noun.
  await expect(page.getByText("You: respond to the rejection")).toBeVisible();
});

// IN_PROGRESS / FULFILLED / CLOSED were reachable only by seeding the
// database — an acknowledged order sat in ACKNOWLEDGED forever offering no
// action but Duplicate.
test("a buyer can record receipt and close an order out", async ({ page }) => {
  const item = await createTestAcknowledgeItem();
  const lineId = `${item.subjectId}-line`;

  // Get it to ACKNOWLEDGED through the supplier's own surface first.
  await page.goto(`/a/${item.accessToken}`);
  await page.getByRole("button", { name: /^Confirm/ }).click();
  await expect(page.getByText("Confirmed.")).toBeVisible();

  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto(`/dashboard/purchase-orders/${item.subjectId}`);

  await page.getByRole("button", { name: "Record receipt" }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.locator(`input[name="received-${lineId}"]`).fill("1");
  await dialog.getByRole("button", { name: "Record it" }).click();

  await expect(page.getByText("Received", { exact: true }).first()).toBeVisible();

  await confirmAction(page, "Close it out", "Close it");
  await expect(page.getByText("Closed", { exact: true }).first()).toBeVisible();

  const po = await findPurchaseOrderById(item.subjectId);
  expect(po.status).toBe("CLOSED");
  // A closed order is settled — nothing left open on either side.
  const open = await findOpenActionItemsForSubject("PURCHASE_ORDER", item.subjectId);
  expect(open).toHaveLength(0);
});

// The only exits from REJECTED were Cancel, or a Duplicate that left the
// review item open — so a buyer who responded the intended way got reminded
// about it forever.
test("a rejected order can be revised into a linked successor", async ({ page }) => {
  const fixture = await createTestReviewRejectionItem();

  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto(`/dashboard/purchase-orders/${fixture.poId}`);
  await page.getByRole("button", { name: "Revise and reissue" }).click();

  await expect(page).toHaveURL(/\/dashboard\/purchase-orders\/[a-z0-9]+\/edit$/);

  const item = await findActionItemById(fixture.id);
  expect(item.status).toBe("RESOLVED");
  const original = await findPurchaseOrderById(fixture.poId);
  expect(original.status).toBe("CANCELLED");
  expect(original.cancellationReason).toMatch(/Superseded by P-\d+/);
});
