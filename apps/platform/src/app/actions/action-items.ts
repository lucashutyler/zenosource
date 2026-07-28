"use server";

import { revalidatePath } from "next/cache";
import { findOpenActionItemByToken, resolveActionItem } from "@/lib/action-items";

// No session check here on purpose — possession of the token is the
// authorization for this one action item. See docs/architecture.md
// #action-items--reminders.
export async function resolveActionItemByToken(token: string) {
  const item = await findOpenActionItemByToken(token);
  if (!item) {
    return { error: "This item was already resolved or the link is invalid." };
  }
  await resolveActionItem(item.id);
  revalidatePath(`/a/${token}`);
  return { error: undefined };
}
