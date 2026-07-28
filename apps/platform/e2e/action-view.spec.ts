import { test, expect } from "@playwright/test";
import {
  findOpenActionItem,
  findActionItemById,
  findPurchaseOrderById,
  createTestAcknowledgeItem,
} from "./helpers/db";

test("supplier can acknowledge a PO via the no-login link, and reopening it after resolution shows already-resolved", async ({
  browser,
}) => {
  const item = await findOpenActionItem("PO_ACKNOWLEDGE");

  const ctx1 = await browser.newContext();
  const page1 = await ctx1.newPage();
  await page1.goto(`/a/${item.accessToken}`);
  await expect(page1.getByText("Respond to this purchase order")).toBeVisible();
  await page1.click('button:has-text("Acknowledge")');
  await expect(page1.getByText("Thanks — recorded.")).toBeVisible();
  await ctx1.close();

  // Reopening the same link afterward — this is the exact scenario the
  // atomic tryResolveActionItem guard exists for.
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto(`/a/${item.accessToken}`);
  await expect(page2.getByText("already resolved")).toBeVisible();
  await ctx2.close();

  const resolved = await findActionItemById(item.id);
  expect(resolved.status).toBe("RESOLVED");
});

test("two concurrent acknowledge attempts on the same link only resolve once", async ({ browser }) => {
  // A fresh item of its own — the seed's single PO_ACKNOWLEDGE item may
  // already have been resolved by another test in this run.
  const item = await createTestAcknowledgeItem();

  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()]);
  const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);

  await Promise.all([pageA.goto(`/a/${item.accessToken}`), pageB.goto(`/a/${item.accessToken}`)]);

  async function clickAndWaitForOutcome(page: (typeof pageA)) {
    await page.click('button:has-text("Acknowledge")');
    await page
      .getByText("Thanks — recorded.")
      .or(page.getByText("already resolved"))
      .waitFor({ state: "visible" });
    return (await page.textContent("body")) ?? "";
  }

  const [resultA, resultB] = await Promise.all([
    clickAndWaitForOutcome(pageA),
    clickAndWaitForOutcome(pageB),
  ]);

  const outcomes = [resultA, resultB].map((text) =>
    text.includes("Thanks — recorded.") ? "resolved" : "already-handled"
  );
  expect(outcomes.filter((o) => o === "resolved")).toHaveLength(1);
  expect(outcomes.filter((o) => o === "already-handled")).toHaveLength(1);

  await ctxA.close();
  await ctxB.close();

  const po = await findPurchaseOrderById(item.subjectId);
  expect(po.status).toBe("ACKNOWLEDGED"); // not double-processed into some other state
});
