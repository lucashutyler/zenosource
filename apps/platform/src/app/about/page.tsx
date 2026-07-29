import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "About" };

type Dep = { name: string; version: string; license: string; url: string };

// Direct, production-runtime dependencies — checked against license-checker
// output. Build-only/dev tooling (eslint, tsx, playwright, tailwindcss'
// own build-time deps, etc.) is intentionally omitted; this page is about
// what actually ships and runs, not the full dev toolchain.
const DEPENDENCIES: Dep[] = [
  { name: "Next.js", version: "16.2.12", license: "MIT", url: "https://github.com/vercel/next.js" },
  { name: "React", version: "19.2.4", license: "MIT", url: "https://github.com/facebook/react" },
  { name: "React DOM", version: "19.2.4", license: "MIT", url: "https://github.com/facebook/react" },
  { name: "Tailwind CSS", version: "4.x", license: "MIT", url: "https://github.com/tailwindlabs/tailwindcss" },
  { name: "Prisma Client", version: "7.9.1", license: "Apache-2.0", url: "https://github.com/prisma/prisma" },
  { name: "@prisma/adapter-pg", version: "7.9.1", license: "Apache-2.0", url: "https://github.com/prisma/prisma" },
  { name: "node-postgres (pg)", version: "8.22.0", license: "MIT", url: "https://github.com/brianc/node-postgres" },
  { name: "jose", version: "6.2.4", license: "MIT", url: "https://github.com/panva/jose" },
  { name: "bcryptjs", version: "3.0.3", license: "BSD-3-Clause", url: "https://github.com/dcodeIO/bcrypt.js" },
  { name: "Zod", version: "4.4.3", license: "MIT", url: "https://github.com/colinhacks/zod" },
  { name: "lucide-react", version: "1.27.0", license: "ISC", url: "https://github.com/lucide-icons/lucide" },
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-ink-faint">ZenoSource</p>
      <h1 className="mb-8 text-xl font-semibold tracking-tight text-ink">About</h1>

      <section className="mb-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-faint">
          Open source acknowledgments
        </h2>
        <p className="mb-4 text-sm text-ink-soft">
          ZenoSource is built with these open source projects, among others pulled in transitively
          under their own compatible licenses.
        </p>
        <ul className="divide-y divide-rule border border-rule bg-paper-raised">
          {DEPENDENCIES.map((dep) => (
            <li key={dep.name} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <a
                href={dep.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline underline-offset-2"
              >
                {dep.name}
              </a>
              <span className="font-mono text-xs text-ink-faint">
                v{dep.version} · {dep.license}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Link href="/dashboard" className="text-sm text-ink-soft underline underline-offset-2">
        Back to ZenoSource
      </Link>
    </div>
  );
}
