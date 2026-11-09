"use client";

import { useActionState, useState } from "react";
import { FormAlert, SubmitButton } from "@/components/form-controls";
import { initialFormState } from "@/lib/form-state";
import { uploadLogoAction } from "./actions";

export function LogoForm() {
  const [state, action] = useActionState(uploadLogoAction, initialFormState);
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <form action={action} className="space-y-4">
      <FormAlert state={state} />
      <div className="flex flex-wrap items-center gap-4">
        {preview && (
          // biome-ignore lint/performance/noImgElement: vista previa local (blob:) antes de subir
          <img
            src={preview}
            alt="Vista previa del logo"
            className="size-20 rounded-lg border border-slate-200 object-contain p-1"
          />
        )}
        <div className="min-w-56 flex-1">
          <label htmlFor="logo" className="label">
            Nuevo logo
          </label>
          <input
            id="logo"
            name="logo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            required
            onChange={(e) => {
              const file = e.target.files?.[0];
              setPreview(file ? URL.createObjectURL(file) : null);
            }}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
          />
          <p className="mt-1 text-xs text-slate-500">
            PNG, JPG o WebP de hasta 300 KB. Mejor si es cuadrado.
          </p>
        </div>
      </div>
      <SubmitButton pendingText="Subiendo…">Guardar logo</SubmitButton>
    </form>
  );
}
