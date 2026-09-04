"use client";

// The one button style every screen uses. Three variants cover the whole
// graybox vocabulary: primary (go), ghost (nav/neutral), danger (destructive).
type Variant = "primary" | "ghost" | "danger";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-brand text-brand-fg font-bold hover:brightness-110 disabled:opacity-40",
  ghost:
    "border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-40",
  danger:
    "border border-red-500/40 text-red-400 hover:border-red-500 hover:text-red-300 disabled:opacity-40",
};

export function ArenaButton({
  variant = "primary",
  children,
  onClick,
  disabled,
  fullWidth,
  className,
  type = "button",
  testId,
}: {
  variant?: Variant;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  fullWidth?: boolean;
  className?: string;
  type?: "button" | "submit";
  testId?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={[
        "rounded-md px-4 py-2.5 text-sm uppercase tracking-wider transition-colors",
        VARIANT_CLASSES[variant],
        fullWidth ? "w-full" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </button>
  );
}
