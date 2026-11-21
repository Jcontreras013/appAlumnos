import { describe, expect, it } from "vitest";
import { messageInputSchema, pushSubscriptionSchema, withinNotifyHours } from "./messages";

describe("horario de atención (hora de Honduras)", () => {
  it("avisa de lunes a viernes de 6:00 a 19:00", () => {
    expect(withinNotifyHours(new Date("2026-11-09T12:00:00Z"))).toBe(true); // lunes 6:00
    expect(withinNotifyHours(new Date("2026-11-13T00:59:00Z"))).toBe(true); // jueves 18:59
    expect(withinNotifyHours(new Date("2026-11-13T01:00:00Z"))).toBe(false); // jueves 19:00
    expect(withinNotifyHours(new Date("2026-11-09T11:59:00Z"))).toBe(false); // lunes 5:59
  });

  it("no avisa el fin de semana, aunque en UTC ya sea lunes", () => {
    expect(withinNotifyHours(new Date("2026-11-14T16:00:00Z"))).toBe(false); // sábado 10:00
    expect(withinNotifyHours(new Date("2026-11-16T03:00:00Z"))).toBe(false); // domingo 21:00
  });
});

describe("mensajes", () => {
  it("quita espacios y exige texto", () => {
    expect(messageInputSchema.parse({ body: "  Hola  " }).body).toBe("Hola");
    expect(messageInputSchema.safeParse({ body: " " }).success).toBe(false);
  });

  it("solo acepta suscripciones de avisos por https", () => {
    const keys = { p256dh: "a", auth: "b" };
    expect(pushSubscriptionSchema.safeParse({ endpoint: "https://fcm.googleapis.com/x", keys }).success).toBe(
      true,
    );
    expect(pushSubscriptionSchema.safeParse({ endpoint: "http://intranet/x", keys }).success).toBe(false);
  });
});
