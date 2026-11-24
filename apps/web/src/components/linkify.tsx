import { Fragment } from "react";

const URL_PATTERN = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]])/g;

/**
 * Texto escrito por el maestro con sus saltos de línea, y los enlaces que pegó convertidos en enlaces
 * (React escapa el resto: no se interpreta HTML).
 */
export function Linkify({ text, className }: { text: string; className?: string }) {
  const parts = text.split(URL_PATTERN);
  return (
    <p className={`whitespace-pre-wrap break-words ${className ?? ""}`}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a
            // biome-ignore lint/suspicious/noArrayIndexKey: las partes del texto no cambian de orden
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-700 underline"
          >
            {part}
          </a>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: las partes del texto no cambian de orden
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </p>
  );
}
