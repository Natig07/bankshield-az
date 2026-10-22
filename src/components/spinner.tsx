// A small ring that inherits the surrounding text colour. The motion is dropped for people who ask
// for reduced motion; the partial ring still reads as "working" without it.
export function Spinner({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" className={`${className} shrink-0 animate-spin motion-reduce:animate-none`}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
