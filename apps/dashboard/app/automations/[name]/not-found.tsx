import Link from "next/link";

export default function AutomationNotFound() {
  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <h1 className="text-lg font-semibold tracking-tight">Unknown automation</h1>
      <p className="mt-2 text-xs text-faint">
        There is no matching directory in <code className="font-mono">automations/</code>.
      </p>
      <Link href="/" className="mt-4 inline-block text-xs text-info hover:underline">
        ← Automations
      </Link>
    </div>
  );
}
