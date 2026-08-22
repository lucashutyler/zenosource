import { createServer } from "node:http";
import { createFakeOkta } from "@zenosource/okta/testing";

// A scripted identity provider for local development.
//
// The auth equivalent of the dev mailbox at /dashboard/emails: the whole
// sign-in loop works without the thing it would normally need, so a developer
// can exercise federation without an Okta org and a demo doesn't depend on
// somebody's tenant still existing.
//
// Deliberately a separate process rather than a route inside apps/platform.
// A route in the shipped app that mints signed assertions is a total
// authentication bypass sitting behind an environment check, and environment
// checks get forgotten exactly once. Nothing under apps/platform/src imports
// this file or the package entry it uses.

const port = Number(process.env.FAKE_IDP_PORT ?? 3101);
const fake = createFakeOkta({ issuer: `http://localhost:${port}` });

createServer(fake.handler).listen(port, () => {
  console.log(`Fake identity provider on http://localhost:${port}`);
  console.log(`  issuer         http://localhost:${port}`);
  console.log(`  client id      ${fake.clientId}`);
  console.log(`  client secret  ${fake.clientSecret}`);
  console.log(`\nIt signs in whoever the address asks for, with no password:`);
  for (const user of fake.users) {
    console.log(`  ${user.email}  (${user.name})`);
  }
  console.log(`\nSign in at http://localhost:3000/login/sso`);
});
