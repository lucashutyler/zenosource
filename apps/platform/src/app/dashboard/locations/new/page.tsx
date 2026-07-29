import type { Metadata } from "next";
import { getCurrentInternalUser } from "@/lib/dal";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { LocationForm } from "../location-form";

export const metadata: Metadata = { title: "Add a location" };

export default async function NewLocationPage() {
  const user = await getCurrentInternalUser();

  // Checked here as well as in the action.
  //
  // The form used to render in full for a MEMBER and only refuse on submit,
  // after they'd typed an address — the audit's example of an authorization
  // rule that's correct on the server and dishonest on the screen. The action
  // keeps its own gate; this one exists so nobody wastes their time.
  if (user.role !== "OWNER") {
    return (
      <div>
        <PageHeader
          back={{ href: "/dashboard/locations", label: "All locations" }}
          title="Add a location"
        />
        <EmptyState
          headline="Owners manage locations."
          body="A location decides who can see which orders, so creating one is an access-control decision. Ask an owner on your team."
          action={<LinkButton href="/dashboard/locations">Back to locations</LinkButton>}
        />
      </div>
    );
  }

  return <LocationForm mode="create" />;
}
