"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { saveNativePushAction } from "@/app/panel/mensajes/actions";
import {
  nativePermission,
  nativePushAvailable,
  onNativeNotificationTap,
  registerNativePush,
  storedNativeToken,
  storeNativeToken,
} from "@/lib/native-push";

/**
 * Lo que hace el panel cuando corre dentro de la app de Android: al tocar un aviso, abre la
 * conversación; y si los avisos están activados, vuelve a guardar el identificador de Firebase (puede
 * cambiar). En el navegador no hace nada.
 */
export function NativeAppBridge({ messaging }: { messaging: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!nativePushAvailable()) return;
    onNativeNotificationTap((url) => router.push(url as Parameters<typeof router.push>[0]));
    if (!messaging || !storedNativeToken()) return;
    void (async () => {
      if ((await nativePermission()) !== "granted") return;
      const token = await registerNativePush();
      if (token !== storedNativeToken() && (await saveNativePushAction(token)).ok) storeNativeToken(token);
    })().catch(() => {});
  }, [messaging, router]);

  return null;
}
