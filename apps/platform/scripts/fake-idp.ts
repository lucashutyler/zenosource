import { createServer } from "node:http";
import { createFakeOkta } from "@zenosource/okta/testing";

// A separate process rather than a route: an endpoint in the shipped app that
// mints signed assertions is an authentication bypass behind an environment
// check, and nothing under apps/platform/src may import this.

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
