import { type InputHTMLAttributes, type SelectHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 ${className}`}
    >
      {children}
    </div>
  );
}

export function Field({
  label,
  name,
  children,
}: {
  label: string;
  name: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-4">
      <label
        htmlFor={name}
        className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function ErrorText({ children }: { children?: string }) {
  if (!children) return null;
  return <p className="mb-4 text-sm text-red-600 dark:text-red-400">{children}</p>;
}

export function SubmitButton({
  children,
  pending,
  variant = "primary",
}: {
  children: ReactNode;
  pending?: boolean;
  variant?: "primary" | "secondary" | "danger";
}) {
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-500",
    secondary:
      "border border-zinc-300 text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900",
    danger: "bg-red-600 text-white hover:bg-red-500",
  };
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50 ${variants[variant]}`}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
}) {
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-500",
    secondary:
      "border border-zinc-300 text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900",
  };
  return (
    <Link
      href={href}
      className={`inline-flex rounded-md px-3 py-2 text-sm font-medium ${variants[variant]}`}
    >
      {children}
    </Link>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between">
      <div>
        <h1 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{title}</h1>
        {subtitle && <p className="text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warning" | "success" | "danger" }) {
  const tones = {
    neutral: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    warning: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    success: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    danger: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
