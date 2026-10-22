"use client";

import { useFormStatus } from "react-dom";
import { Spinner } from "./spinner";

// Drop-in submit button. While its form's action is running it disables itself (so a second click
// cannot send the same request twice) and shows a spinner. When a form has several submit buttons
// that carry a name and value, only the one that was pressed shows the spinner.
export function SubmitButton({ children, disabled, className = "", ...rest }: React.ComponentPropsWithoutRef<"button">) {
  const { pending, data } = useFormStatus();
  const pressed = pending && (!rest.name || data?.get(rest.name) === rest.value);
  return (
    <button
      type="submit"
      {...rest}
      disabled={disabled || pending}
      aria-busy={pressed || undefined}
      className={`${className} inline-flex items-center justify-center gap-2`}
    >
      {pressed ? <Spinner /> : null}
      {children}
    </button>
  );
}
