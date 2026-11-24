"use client";

import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useCallback, useEffect, useRef, useState } from "react";
import { savedLibraryFile } from "@/lib/library-offline";
import { libraryFileUrl } from "@/lib/library-urls";

/*
 * Lector de PDF de la biblioteca (pdf.js). Lo hace la página y no el navegador porque el visor de
 * Android (también el de la app) no abre PDF. Baja solo las páginas que se van leyendo (por tramos:
 * gasta pocos datos con un libro de 200 páginas) y dibuja solo las cercanas a la pantalla, para que
 * un teléfono sencillo no se quede sin memoria. Si el libro está guardado en el teléfono, lo abre de
 * ahí, sin internet.
 */

/** Más nitidez que esto no se nota en un teléfono y gasta mucha memoria. */
const MAX_PIXEL_RATIO = 2;
/** Tope de píxeles por página dibujada (los teléfonos no dibujan lienzos más grandes). */
const MAX_CANVAS_PIXELS = 12_000_000;
/** Páginas dibujadas antes y después de la que se está leyendo. */
const KEEP_AROUND = 2;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

type Size = { width: number; height: number };

const pageKey = (id: string) => `conecta:biblioteca:${id}:pagina`;
function rememberPage(id: string, page: number) {
  try {
    localStorage.setItem(pageKey(id), String(page));
  } catch {
    // Sin almacenamiento (modo privado): no se recuerda.
  }
}
function lastPage(id: string): number {
  try {
    return Number(localStorage.getItem(pageKey(id))) || 1;
  } catch {
    return 1;
  }
}

function explain(err: unknown, offline: boolean): string {
  const name = (err as { name?: string } | null)?.name;
  if (name === "PasswordException")
    return "Este PDF tiene contraseña: descárgalo y ábrelo con otro programa.";
  if (name === "InvalidPDFException") return "El archivo está dañado o no es un PDF que se pueda leer.";
  if (offline) {
    return "Sin internet: este libro no está guardado en el dispositivo. Ábrelo con conexión y toca «Guardar para leer sin internet».";
  }
  return "No se pudo abrir el libro. Revisa tu conexión e intenta de nuevo.";
}

export function PdfReader({ id }: { id: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [base, setBase] = useState<Size | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [current, setCurrent] = useState(1);
  const [resume, setResume] = useState<number | null>(null);
  const [fromDevice, setFromDevice] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const pages = useRef<HTMLDivElement>(null);

  // Abrir el libro: del teléfono si está guardado; si no, de internet por tramos.
  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      const assets = `/pdfjs/${pdfjs.version}/`;
      pdfjs.GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.min.mjs`;
      const saved = await savedLibraryFile(id);
      if (cancelled) return;
      setFromDevice(Boolean(saved));
      const common = {
        cMapUrl: `${assets}cmaps/`,
        standardFontDataUrl: `${assets}standard_fonts/`,
        wasmUrl: `${assets}wasm/`,
        iccUrl: `${assets}iccs/`,
      };
      task = pdfjs.getDocument(
        saved
          ? { ...common, data: new Uint8Array(saved) }
          : {
              ...common,
              url: libraryFileUrl(id),
              rangeChunkSize: 256 * 1024,
              // Solo lo que se va leyendo, no el libro completo de una vez.
              disableAutoFetch: true,
              disableStream: true,
            },
      );
      task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
        if (total) setProgress(Math.min(1, loaded / total));
      };
      const opened = await task.promise;
      if (cancelled) return;
      const first = await opened.getPage(1);
      const viewport = first.getViewport({ scale: 1 });
      if (cancelled) return;
      setBase({ width: viewport.width, height: viewport.height });
      setDoc(opened);
      const last = lastPage(id);
      if (last > 1 && last <= opened.numPages) setResume(last);
    })().catch((err) => {
      if (!cancelled) setError(explain(err, typeof navigator !== "undefined" && !navigator.onLine));
    });
    return () => {
      cancelled = true;
      // Cierra el libro y su worker (también si todavía se estaba abriendo).
      void task?.destroy();
    };
  }, [id]);

  // Ancho disponible: la página se ajusta al ancho de la pantalla.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // La página que se está leyendo: la que cruza el centro de la pantalla.
  useEffect(() => {
    const container = pages.current;
    if (!doc || !container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const n = Number((entry.target as HTMLElement).dataset.page);
            if (n) setCurrent(n);
          }
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    for (const el of container.querySelectorAll("[data-page]")) observer.observe(el);
    return () => observer.disconnect();
  }, [doc]);

  useEffect(() => {
    if (doc && current > 1) rememberPage(id, current);
  }, [doc, id, current]);

  const goTo = useCallback((n: number) => {
    document.getElementById(`pdf-pagina-${n}`)?.scrollIntoView({ block: "start" });
  }, []);

  const fit = base && width ? (width - 16) / base.width : 1;
  const scale = Math.max(0.2, fit * zoom);
  const zoomIndex = ZOOMS.indexOf(zoom);

  if (error) {
    return (
      <p className="card p-6 text-sm font-medium text-red-700" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div ref={frame} className="space-y-3">
      <div
        className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur"
        role="toolbar"
        aria-label="Lector"
      >
        {doc ? (
          <form
            className="flex items-center gap-1.5 text-sm text-slate-700"
            onSubmit={(e) => {
              e.preventDefault();
              const value = Number(new FormData(e.currentTarget).get("pagina"));
              if (value >= 1 && value <= doc.numPages) goTo(value);
            }}
          >
            <label htmlFor="pdf-ir">Página</label>
            <input
              id="pdf-ir"
              key={current}
              name="pagina"
              type="number"
              inputMode="numeric"
              min={1}
              max={doc.numPages}
              defaultValue={current}
              className="w-16 rounded-md border border-slate-300 px-2 py-1 text-center"
            />
            <span>de {doc.numPages}</span>
          </form>
        ) : (
          <span className="text-sm text-slate-500" aria-live="polite">
            Abriendo el libro…{progress > 0 && progress < 1 ? ` ${Math.round(progress * 100)} %` : ""}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="btn-secondary px-3 py-1"
            aria-label="Alejar"
            disabled={zoomIndex <= 0}
            onClick={() => setZoom(ZOOMS[Math.max(0, zoomIndex - 1)] ?? 1)}
          >
            −
          </button>
          <button
            type="button"
            className="min-w-14 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-100"
            onClick={() => setZoom(1)}
            title="Ajustar al ancho"
          >
            {Math.round(zoom * 100)} %
          </button>
          <button
            type="button"
            className="btn-secondary px-3 py-1"
            aria-label="Acercar"
            disabled={zoomIndex >= ZOOMS.length - 1}
            onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomIndex + 1)] ?? 1)}
          >
            +
          </button>
        </div>
      </div>

      {fromDevice && (
        <p className="px-1 text-xs text-emerald-700">Abierto desde este dispositivo (sin internet).</p>
      )}
      {resume && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">
          Te quedaste en la página {resume}.
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => {
              goTo(resume);
              setResume(null);
            }}
          >
            Seguir leyendo
          </button>
          <button type="button" className="ml-auto text-brand-700" onClick={() => setResume(null)}>
            Empezar desde el inicio
          </button>
        </div>
      )}

      <div ref={pages} className="overflow-x-auto rounded-xl bg-slate-200 p-2">
        <div className="mx-auto flex w-max flex-col items-center gap-2">
          {doc && base
            ? Array.from({ length: doc.numPages }, (_, i) => i + 1).map((n) => (
                <PdfPage
                  key={n}
                  doc={doc}
                  number={n}
                  scale={scale}
                  estimate={base}
                  draw={Math.abs(n - current) <= KEEP_AROUND}
                />
              ))
            : !error && (
                <div className="h-[60vh] w-full animate-pulse rounded bg-white/60" style={{ width }} />
              )}
        </div>
      </div>
    </div>
  );
}

function PdfPage({
  doc,
  number,
  scale,
  estimate,
  draw,
}: {
  doc: PDFDocumentProxy;
  number: number;
  scale: number;
  estimate: Size;
  draw: boolean;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const real = size ?? estimate;

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    if (!draw) {
      // Lejos de la pantalla: se suelta el dibujo para liberar memoria.
      for (const old of el.querySelectorAll("canvas")) {
        old.width = 0;
        old.height = 0;
      }
      el.replaceChildren();
      return;
    }
    let cancelled = false;
    let task: RenderTask | null = null;
    (async () => {
      const page = await doc.getPage(number);
      if (cancelled) return;
      const natural = page.getViewport({ scale: 1 });
      setSize((s) =>
        s && s.width === natural.width && s.height === natural.height
          ? s
          : { width: natural.width, height: natural.height },
      );
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      const limit = Math.sqrt(MAX_CANVAS_PIXELS / (natural.width * natural.height));
      const viewport = page.getViewport({ scale: Math.min(scale * ratio, limit) });
      // Se dibuja en un lienzo nuevo y se cambia al terminar: el dibujo anterior queda a la vista
      // mientras tanto (al acercar o alejar) y dos dibujos nunca usan el mismo lienzo.
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.className = "block h-full w-full";
      canvas.setAttribute("aria-hidden", "true");
      task = page.render({ canvas, viewport });
      await task.promise;
      if (cancelled) return;
      for (const old of el.querySelectorAll("canvas")) {
        old.width = 0;
        old.height = 0;
      }
      el.replaceChildren(canvas);
    })().catch((err) => {
      if ((err as { name?: string } | null)?.name !== "RenderingCancelledException" && !cancelled) {
        el.replaceChildren();
        el.textContent = "No se pudo mostrar esta página.";
      }
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, number, scale, draw]);

  return (
    <div
      id={`pdf-pagina-${number}`}
      data-page={number}
      role="img"
      aria-label={`Página ${number}`}
      className="relative scroll-mt-20 grid place-items-center bg-white text-sm text-slate-400 shadow"
      style={{ width: Math.floor(real.width * scale), height: Math.floor(real.height * scale) }}
    >
      <div ref={holder} className="absolute inset-0" />
    </div>
  );
}
