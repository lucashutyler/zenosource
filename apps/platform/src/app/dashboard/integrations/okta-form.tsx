"use client";

import { useActionState, useState } from "react";
import { connectIntegration, type FormActionState } from "@/app/actions/integrations";
import {
  FormErrors,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
} from "@/components/forms";
import { valueFor } from "@/lib/form-state";

export function OktaConnectForm({ integrationId }: { integrationId: string }) {
  const [state, formAction] = useActionState<FormActionState, FormData>(
    connectIntegration,
    undefined
  );
  const [protocol, setProtocol] = useState("OIDC");

  const errors = state?.fieldErrors ?? {};

  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="integrationId" value={integrationId} />

      <p className="mb-4 max-w-2xl text-sm text-ink-soft">
        Your identity provider decides which of these two it speaks — whoever created the
        ZenoSource application at your end already chose. Pick the same one here.
      </p>

      <FormErrors state={state} />

      <div className="grid gap-x-6 sm:grid-cols-2">
        <SelectField
          label="Sign-in protocol"
          name="protocol"
          required
          error={errors.protocol}
          value={protocol}
          onChange={(event) => setProtocol(event.target.value)}
        >
          <option value="OIDC">OpenID Connect</option>
          <option value="SAML">SAML 2.0</option>
        </SelectField>

        {protocol === "OIDC" ? (
          <>
            <TextField
              label="Issuer URL"
              name="issuer"
              required
              placeholder="https://yourcompany.okta.com/oauth2/default"
              hint="The authorization server, exactly as it appears there. Not the /.well-known/… address."
              error={errors.issuer}
              defaultValue={valueFor(state, "issuer", "")}
            />
            <TextField
              label="Client ID"
              name="clientId"
              required
              hint="From the application you created for ZenoSource."
              error={errors.clientId}
              defaultValue={valueFor(state, "clientId", "")}
            />
            <TextField
              label="Client secret"
              name="clientSecret"
              type="password"
              required
              autoComplete="new-password"
              hint="Used only on the server, never in a browser."
              error={errors.clientSecret}
              defaultValue={valueFor(state, "clientSecret", "")}
            />
          </>
        ) : (
          <>
            <div className="sm:col-span-2">
              <TextAreaField
                label="Identity provider metadata"
                name="metadataXml"
                rows={6}
                optional
                hint="Paste the metadata document your identity provider generated. It carries the sign-in URL and the signing certificate, so the three fields below fill themselves."
                error={errors.metadataXml}
                defaultValue={valueFor(state, "metadataXml", "")}
              />
            </div>
            <TextField
              label="Identity provider entity ID"
              name="idpEntityId"
              optional
              hint="Only if you're not pasting metadata."
              error={errors.idpEntityId}
              defaultValue={valueFor(state, "idpEntityId", "")}
            />
            <TextField
              label="Sign-in URL"
              name="ssoUrl"
              optional
              placeholder="https://yourcompany.okta.com/app/…/sso/saml"
              error={errors.ssoUrl}
              defaultValue={valueFor(state, "ssoUrl", "")}
            />
            <div className="sm:col-span-2">
              <TextAreaField
                label="Signing certificate"
                name="certificate"
                rows={4}
                optional
                hint="Only if you're not pasting metadata. Paste it with or without the BEGIN CERTIFICATE lines."
                error={errors.certificate}
                defaultValue={valueFor(state, "certificate", "")}
              />
            </div>
            <div className="sm:col-span-2 mb-4">
              <label className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  name="responseSigned"
                  className="mt-0.5 border-rule"
                  defaultChecked={valueFor(state, "responseSigned", "") === "on"}
                />
                <span>
                  My identity provider signs the whole response, not just the assertion
                  <span className="mt-0.5 block text-xs text-ink-faint">
                    Leave this off unless you turned it on there. Requiring a signature that
                    isn&apos;t sent rejects every sign-in; the assertion&apos;s own signature is
                    always required either way.
                  </span>
                </span>
              </label>
            </div>
          </>
        )}
      </div>

      <div className="mt-2">
        <SubmitButton variant="primary" pendingLabel="Checking…">
          Connect and test
        </SubmitButton>
      </div>

      <p className="mt-3 max-w-2xl text-xs text-ink-faint">
        Connecting adds a second way to sign in. It doesn&apos;t take the first one away, and it
        doesn&apos;t change anyone&apos;s access — people keep the role and locations they already
        have, and anyone new arrives with none until you give them some.
      </p>
    </form>
  );
}
