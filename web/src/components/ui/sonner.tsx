import { Toaster as Sonner, toast, type ToasterProps } from "sonner";

// Flat, theme-matched toasts: no drop shadow, warm-paper surface, ink text,
// and severity accents pulled from the app's own CSS tokens. Sonner already
// disables its slide/fade transitions under prefers-reduced-motion.
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="bottom-right"
      gap={10}
      toastOptions={{
        classNames: {
          toast:
            "!rounded-xl !border !border-border/70 !bg-card !text-foreground !shadow-none !text-[13px] !font-sans",
          description: "!text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground !rounded-md",
          cancelButton: "!bg-muted !text-muted-foreground !rounded-md",
          success: "!text-good [&_[data-icon]]:!text-good",
          error: "!text-bad [&_[data-icon]]:!text-bad",
        },
      }}
      style={{ ["--normal-border" as string]: "var(--border)" }}
      {...props}
    />
  );
}

export { Toaster, toast };
