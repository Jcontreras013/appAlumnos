import { describe, expect, it } from "vitest";
import { licenseFromGumroad } from "./license";

const ok = (purchase = {}) => ({ success: true, uses: 1, purchase: { product_id: "p", ...purchase } });

describe("licencia de Gumroad", () => {
  it("una compra pagada es válida", () => {
    expect(licenseFromGumroad(200, ok())).toEqual({ state: "valida", reason: null });
  });

  it("una clave que no existe, desactivada o vencida bloquea, explicado en español", () => {
    const r = licenseFromGumroad(404, {
      success: false,
      message: "That license does not exist for the provided product.",
    });
    expect(r).toEqual({ state: "invalida", reason: "La clave de licencia no existe para este producto" });
    const disabled = licenseFromGumroad(404, {
      success: false,
      message: "This license key has been disabled.",
    });
    expect(disabled.reason).toBe("La clave de licencia fue desactivada");
    const expired = licenseFromGumroad(404, {
      success: false,
      message: "Access to the purchase has expired.",
    });
    expect(expired.reason).toBe("La licencia venció");
    expect(licenseFromGumroad(404, null).state).toBe("invalida");
  });

  it.each([
    [{ refunded: true }, "reembolsada"],
    [{ chargebacked: true }, "contracargo"],
    [{ disputed: true }, "disputa"],
    [{ subscription_ended_at: "2026-10-01T00:00:00Z" }, "terminó"],
  ])("compra %o: no es válida", (purchase, reason) => {
    const r = licenseFromGumroad(200, ok(purchase));
    expect(r.state).toBe("invalida");
    expect(r.reason).toContain(reason);
  });

  it("una disputa que ganó el vendedor sigue siendo válida", () => {
    expect(licenseFromGumroad(200, ok({ disputed: true, dispute_won: true })).state).toBe("valida");
  });

  it("si Gumroad falla o responde algo raro, no se bloquea a nadie", () => {
    expect(licenseFromGumroad(500, null).state).toBe("sin-verificar");
    expect(licenseFromGumroad(502, { success: false }).state).toBe("sin-verificar");
    expect(licenseFromGumroad(429, { success: false }).state).toBe("sin-verificar");
    expect(licenseFromGumroad(200, null).state).toBe("sin-verificar");
    expect(licenseFromGumroad(200, { success: false }).state).toBe("sin-verificar");
  });
});
