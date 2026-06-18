"use client";

interface RolloverButtonProps {
  action: () => Promise<void>;
}

export default function RolloverButton({ action }: RolloverButtonProps) {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (!confirm("Möchtest du wirklich das Urlaubsjahr für alle Mitglieder abschließen? (Dies kann nicht rückgängig gemacht werden)")) {
      e.preventDefault();
    }
  };

  return (
    <form action={action} onSubmit={handleSubmit} className="mt-6 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <button
        type="submit"
        className="w-full rounded-lg bg-zinc-800 py-2 text-xs font-semibold text-white transition-colors hover:bg-zinc-700 shadow-sm"
      >
        Jahr abschließen / Rollover
      </button>
    </form>
  );
}
