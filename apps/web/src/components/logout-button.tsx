"use client";

import { useRef } from "react";
import { forgetPushOnThisDevice } from "@/components/messages/push-toggle";

/**
 * Cerrar sesión. Antes, este teléfono deja de recibir avisos de mensajes: si es un teléfono compartido,
 * la siguiente persona no recibe los avisos de quien salió. Si eso tarda, se cierra sesión igual.
 */
export function LogoutButton({ action }: { action: () => Promise<void> }) {
  const ready = useRef(false);
  return (
    <form
      action={action}
      onSubmit={async (e) => {
        if (ready.current) return;
        e.preventDefault();
        const form = e.currentTarget;
        await Promise.race([forgetPushOnThisDevice(), new Promise((resolve) => setTimeout(resolve, 2_000))]);
        ready.current = true;
        // En otra vuelta: si lo de los avisos terminó al instante (sin avisos en este teléfono), el
        // navegador todavía está enviando el formulario y ignoraría este segundo envío.
        setTimeout(() => form.requestSubmit(), 0);
      }}
    >
      <button type="submit" className="btn-secondary px-3 py-1.5">
        Cerrar sesión
      </button>
    </form>
  );
}
