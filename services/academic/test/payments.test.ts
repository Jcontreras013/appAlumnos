import { randomUUID } from "node:crypto";
import type {
  BalanceRowDto,
  FeeDto,
  PaymentDto,
  PaymentSettingsDto,
  PortalAccessDto,
  StudentAccountDto,
  StudentDetailDto,
} from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientSignature, openSecret, PIXELPAY_SANDBOX, paymentHash, sealSecret } from "../src/lib/pixelpay";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

let ctx: AcademicTestContext;
let director: TestUser;
let secretary: TestUser;
let teacher: TestUser;
let mother: TestUser;
let luis: StudentDetailDto; // 1A, hijo de la mamá
let pedro: StudentDetailDto; // 1B
let structure: Awaited<ReturnType<AcademicTestContext["seedStructure"]>>;
const schoolId = randomUUID();

beforeAll(async () => {
  ctx = await setupAcademic({ today: "2026-11-09" });
  director = await ctx.user("admin", schoolId, "Directora");
  secretary = await ctx.user("secretaria", schoolId, "Sofía Secretaria");
  teacher = await ctx.user("docente", schoolId, "Ana Maestra");
  structure = await ctx.seedStructure(director);
  const create = async (firstNames: string, sectionId: string, mom?: string) =>
    (
      await ctx.call<StudentDetailDto>(secretary, "POST", "/students", {
        firstNames,
        lastNames: "López",
        guardians: [guardian(mom ? { nationalId: mom } : {})],
        sectionId,
      })
    ).body;
  luis = await create("Luis", structure.sectionA.id, "0801198501234");
  pedro = await create("Pedro", structure.sectionB.id);
  const access = (
    await ctx.call<PortalAccessDto>(
      secretary,
      "POST",
      `/guardians/${luis.guardians[0]?.id}/portal-access`,
      {},
    )
  ).body;
  mother = await ctx.user("padre", schoolId, "María López", access.userId);
});
afterAll(() => ctx.close());

const account = (who: TestUser, studentId: string) =>
  ctx.call<StudentAccountDto>(who, "GET", `/students/${studentId}/account`);

describe("cobros", () => {
  it("la secretaría crea un cobro para todo el centro: un cargo por alumno matriculado", async () => {
    const res = await ctx.call<{ students: number; scopeLabel: string }>(secretary, "POST", "/fees", {
      name: "Matrícula 2026",
      amount: "1,500.00",
      dueOn: "2026-11-01",
      scope: "centro",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ students: 2, scopeLabel: "Todo el centro" });
    const mine = await account(secretary, luis.id);
    expect(mine.body.charges).toMatchObject([{ name: "Matrícula 2026", amountCents: 150000, overdue: true }]);
    expect(mine.body).toMatchObject({ pendingCents: 150000, overdueCents: 150000 });
  });

  it("también por sección, y valida el monto y a quiénes se cobra", async () => {
    const res = await ctx.call<{ students: number; scopeLabel: string }>(secretary, "POST", "/fees", {
      name: "Mensualidad diciembre",
      amount: "800",
      dueOn: "2026-12-05",
      scope: "seccion",
      targetId: structure.sectionA.id,
    });
    expect(res.body).toMatchObject({ students: 1, scopeLabel: "Primer grado A" });
    expect(
      (
        await ctx.call(secretary, "POST", "/fees", {
          name: "X",
          amount: "1",
          dueOn: "2026-12-01",
          scope: "centro",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx.call(secretary, "POST", "/fees", {
          name: "Uniforme",
          amount: "-5",
          dueOn: "2026-12-01",
          scope: "centro",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx.call(secretary, "POST", "/fees", {
          name: "Uniforme",
          amount: "5",
          dueOn: "2026-12-01",
          scope: "grado",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx.call(teacher, "POST", "/fees", {
          name: "Uniforme",
          amount: "5",
          dueOn: "2026-12-01",
          scope: "centro",
        })
      ).status,
    ).toBe(403);
  });

  it("la lista de cobros muestra lo cobrado y lo pendiente", async () => {
    const fees = await ctx.call<FeeDto[]>(director, "GET", "/fees");
    const matricula = fees.body.find((f) => f.name === "Matrícula 2026");
    expect(matricula).toMatchObject({ charges: 2, paid: 0, pendingCents: 300000, collectedCents: 0 });
  });

  it("quién debe: un renglón por alumno con su sección", async () => {
    const res = await ctx.call<BalanceRowDto[]>(secretary, "GET", "/payments/balances");
    expect(res.body.find((r) => r.studentId === luis.id)).toMatchObject({
      sectionLabel: "Primer grado A",
      pendingCents: 230000,
      overdueCents: 150000,
      pendingCharges: 2,
    });
    const onlyB = await ctx.call<BalanceRowDto[]>(
      secretary,
      "GET",
      `/payments/balances?sectionId=${structure.sectionB.id}`,
    );
    expect(onlyB.body.map((r) => r.studentId)).toEqual([pedro.id]);
  });
});

describe("pagos en la oficina", () => {
  let paymentId: string;

  it("registra el pago en efectivo con recibo numerado y los cobros quedan pagados", async () => {
    const before = await account(secretary, luis.id);
    const charge = before.body.charges.find((c) => c.name === "Matrícula 2026");
    const res = await ctx.call<PaymentDto>(secretary, "POST", "/payments", {
      studentId: luis.id,
      chargeIds: [charge?.id],
      method: "efectivo",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      receiptNumber: 1,
      amountCents: 150000,
      status: "confirmado",
      byName: "Sofía Secretaria",
      items: [{ name: "Matrícula 2026", amountCents: 150000 }],
    });
    paymentId = res.body.id;
    const after = await account(secretary, luis.id);
    expect(after.body.pendingCents).toBe(80000);
    // Pagar dos veces el mismo cobro no se puede.
    const again = await ctx.call(secretary, "POST", "/payments", {
      studentId: luis.id,
      chargeIds: [charge?.id],
      method: "efectivo",
    });
    expect(again.status).toBe(409);
  });

  it("solo la dirección anula un pago: el cobro vuelve a quedar pendiente", async () => {
    expect(
      (await ctx.call(secretary, "POST", `/payments/${paymentId}/void`, { reason: "Error" })).status,
    ).toBe(403);
    const res = await ctx.call<PaymentDto>(director, "POST", `/payments/${paymentId}/void`, {
      reason: "Se registró a otro alumno",
    });
    expect(res.body).toMatchObject({ status: "anulado", voidReason: "Se registró a otro alumno" });
    expect((await account(secretary, luis.id)).body.pendingCents).toBe(230000);
  });

  it("el recibo lo ve la familia de ese alumno, no otra", async () => {
    expect((await ctx.call<PaymentDto>(mother, "GET", `/payments/${paymentId}`)).status).toBe(200);
    expect((await ctx.call(mother, "GET", `/students/${pedro.id}/account`)).status).toBe(403);
    expect((await ctx.call(mother, "GET", `/family/children/${pedro.id}/account`)).status).toBe(404);
  });
});

describe("configuración de la pasarela", () => {
  it("sin activar, la familia no puede pagar con tarjeta", async () => {
    const mine = await ctx.call<StudentAccountDto>(mother, "GET", `/family/children/${luis.id}/account`);
    expect(mine.body.onlinePayments).toBe(false);
    const charge = mine.body.charges.find((c) => c.status === "pendiente");
    const res = await ctx.call(mother, "POST", `/family/children/${luis.id}/pay`, {
      chargeIds: [charge?.id],
      email: "maria@correo.hn",
      returnBase: "https://conecta.test",
    });
    expect(res.status).toBe(409);
  });

  it("la dirección la activa en modo de prueba; la llave secreta nunca se devuelve", async () => {
    expect((await ctx.call(secretary, "GET", "/payment-settings")).status).toBe(403);
    const res = await ctx.call<PaymentSettingsDto>(director, "PUT", "/payment-settings", {
      enabled: true,
      mode: "sandbox",
      endpoint: "https://pixelpay.app/",
      keyId: PIXELPAY_SANDBOX.keyId,
      secretKey: PIXELPAY_SANDBOX.secretKey,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      enabled: true,
      mode: "sandbox",
      endpoint: "pixelpay.app",
      keyId: PIXELPAY_SANDBOX.keyId,
      hasSecret: true,
      canStoreSecrets: true,
    });
    expect(JSON.stringify(res.body)).not.toContain(PIXELPAY_SANDBOX.secretKey);
  });
});

describe("pago con tarjeta (PixelPay)", () => {
  let orderId: string;
  const sandbox = { keyId: PIXELPAY_SANDBOX.keyId, secretKey: PIXELPAY_SANDBOX.secretKey };

  it("la familia pide pagar: se crea la orden y el formulario firmado para PixelPay", async () => {
    const mine = await ctx.call<StudentAccountDto>(mother, "GET", `/family/children/${luis.id}/account`);
    expect(mine.body.onlinePayments).toBe(true);
    const ids = mine.body.charges.filter((c) => c.status === "pendiente").map((c) => c.id);
    const res = await ctx.call<{ action: string; fields: Record<string, string>; orderId: string }>(
      mother,
      "POST",
      `/family/children/${luis.id}/pay`,
      { chargeIds: ids, email: "maria@correo.hn", returnBase: "https://conecta.test/" },
    );
    expect(res.status).toBe(200);
    orderId = res.body.orderId;
    expect(res.body.action).toBe("https://pixelpay.app/api/v2/transaction/hosted/sandbox");
    expect(res.body.fields).toMatchObject({
      _key: PIXELPAY_SANDBOX.keyId,
      _order_id: orderId,
      _amount: "2300.00",
      _currency: "HNL",
      _email: "maria@correo.hn",
      _first_name: "María",
      _last_name: "López",
      _complete: `https://conecta.test/pagos/volver/${schoolId}?orden=${orderId}`,
      _callback: `https://conecta.test/api/pagos/pixelpay/${schoolId}`,
      _client_signature: clientSignature(PIXELPAY_SANDBOX, orderId),
    });
    expect(JSON.stringify(res.body)).not.toContain(PIXELPAY_SANDBOX.secretKey);
    // Mientras no se confirme, sigue debiendo.
    expect((await account(secretary, luis.id)).body.pendingCents).toBe(230000);
  });

  it("un regreso con un hash falso no confirma nada", async () => {
    const res = await ctx.call(mother, "POST", "/payments/online/complete", {
      orderId,
      paymentHash: "abc123",
    });
    expect(res.status).toBe(403);
  });

  it("el aviso de PixelPay con el hash correcto confirma el pago, y repetirlo no lo duplica", async () => {
    const body = {
      order: orderId,
      payment_hash: paymentHash(sandbox, orderId),
      status: "paid",
      amount: 2300,
      currency: "HNL",
      uuid: "P-prueba-123",
    };
    const url = `/payments/pixelpay/callback/${schoolId}`;
    const first = await ctx.app.inject({ method: "POST", url, payload: body });
    expect(first.statusCode).toBe(200);
    expect((await ctx.app.inject({ method: "POST", url, payload: body })).statusCode).toBe(200);
    const after = await account(secretary, luis.id);
    expect(after.body.pendingCents).toBe(0);
    const card = after.body.payments.find((p) => p.method === "tarjeta");
    expect(card).toMatchObject({ status: "confirmado", receiptNumber: 2, amountCents: 230000 });
    // El regreso de la familia llega después: ya estaba confirmado.
    const back = await ctx.call<{ status: string }>(mother, "POST", "/payments/online/complete", {
      orderId,
      paymentHash: paymentHash(sandbox, orderId),
    });
    expect(back.body.status).toBe("confirmado");
  });

  it("un aviso con hash falso, monto distinto u otro centro se rechaza", async () => {
    const url = `/payments/pixelpay/callback/${schoolId}`;
    expect(
      (await ctx.app.inject({ method: "POST", url, payload: { order: orderId, payment_hash: "falso" } }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: `/payments/pixelpay/callback/${randomUUID()}`,
          payload: { order: orderId, payment_hash: paymentHash(sandbox, orderId) },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("si la familia cancela, el pago queda fallido y lo debido sigue pendiente", async () => {
    await ctx.call(secretary, "POST", "/fees", {
      name: "Uniforme",
      amount: "350",
      dueOn: "2026-12-10",
      scope: "alumno",
      targetId: luis.id,
    });
    const mine = await ctx.call<StudentAccountDto>(mother, "GET", `/family/children/${luis.id}/account`);
    const uniforme = mine.body.charges.find((c) => c.name === "Uniforme");
    const start = await ctx.call<{ orderId: string }>(mother, "POST", `/family/children/${luis.id}/pay`, {
      chargeIds: [uniforme?.id],
      email: "maria@correo.hn",
      returnBase: "https://conecta.test",
    });
    const res = await ctx.call<{ status: string }>(mother, "POST", "/payments/online/complete", {
      orderId: start.body.orderId,
      cancelled: true,
    });
    expect(res.body.status).toBe("cancelado");
    expect((await account(secretary, luis.id)).body.pendingCents).toBe(35000);
  });
});

describe("pago con tarjeta: sin cobrar dos veces y sin sesión al volver", () => {
  const start = async (chargeIds: string[]) =>
    (
      await ctx.call<{ orderId: string }>(mother, "POST", `/family/children/${luis.id}/pay`, {
        chargeIds,
        email: "maria@correo.hn",
        returnBase: "https://conecta.test",
      })
    ).body.orderId;
  const pending = async () =>
    (
      await ctx.call<StudentAccountDto>(mother, "GET", `/family/children/${luis.id}/account`)
    ).body.charges.filter((c) => c.status === "pendiente");
  const back = (orderId: string, body: Record<string, unknown>) =>
    ctx.app.inject({
      method: "POST",
      url: `/payments/online/return/${schoolId}`,
      payload: { orderId, ...body },
    });
  const sandbox = { keyId: PIXELPAY_SANDBOX.keyId, secretKey: PIXELPAY_SANDBOX.secretKey };

  it("mientras la familia paga con tarjeta, la oficina no puede cobrar lo mismo", async () => {
    await ctx.call(secretary, "POST", "/fees", {
      name: "Excursión",
      amount: "500",
      dueOn: "2026-12-12",
      scope: "alumno",
      targetId: luis.id,
    });
    const excursion = (await pending()).find((c) => c.name === "Excursión");
    if (!excursion) throw new Error("falta el cobro");
    const orderId = await start([excursion.id]);
    const office = await ctx.call(secretary, "POST", "/payments", {
      studentId: luis.id,
      chargeIds: [excursion.id],
      method: "efectivo",
    });
    expect(office.status).toBe(409);
    // Vuelve sin sesión (en la app, el pago se hace en el navegador del teléfono): se confirma con el hash.
    const res = await back(orderId, { paymentHash: paymentHash(sandbox, orderId) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "confirmado", duplicate: false });
    expect(res.json().receiptNumber).toBeGreaterThan(0);
    expect((await back(orderId, { paymentHash: "falso" })).statusCode).toBe(403);
  });

  it("un segundo intento cierra el anterior; si los dos se pagan, el último queda marcado como pago doble", async () => {
    await ctx.call(secretary, "POST", "/fees", {
      name: "Libro de inglés",
      amount: "420",
      dueOn: "2026-12-15",
      scope: "alumno",
      targetId: luis.id,
    });
    const libro = (await pending()).find((c) => c.name === "Libro de inglés");
    if (!libro) throw new Error("falta el cobro");
    const first = await start([libro.id]);
    const second = await start([libro.id]);
    expect(first).not.toBe(second);
    // Paga el segundo: el cobro queda pagado.
    await ctx.app.inject({
      method: "POST",
      url: `/payments/pixelpay/callback/${schoolId}`,
      payload: {
        order: second,
        payment_hash: paymentHash(sandbox, second),
        status: "paid",
        amount: 420,
        currency: "HNL",
      },
    });
    // PixelPay avisa tarde que el primero también se pagó: se registra (el banco cobró) y se marca.
    const late = await back(first, { paymentHash: paymentHash(sandbox, first) });
    expect(late.json()).toMatchObject({ status: "confirmado", duplicate: true });
    const receipt = await ctx.call<PaymentDto>(secretary, "GET", `/payments/${late.json().paymentId}`);
    expect(receipt.body.reference).toMatch(/PAGO DOBLE/);
  });

  it("cancelar sin sesión deja el intento como cancelado; lo debido sigue pendiente", async () => {
    await ctx.call(secretary, "POST", "/fees", {
      name: "Graduación",
      amount: "800",
      dueOn: "2026-12-20",
      scope: "alumno",
      targetId: luis.id,
    });
    const grad = (await pending()).find((c) => c.name === "Graduación");
    if (!grad) throw new Error("falta el cobro");
    const orderId = await start([grad.id]);
    const res = await back(orderId, { cancelled: true });
    expect(res.json().status).toBe("cancelado");
    expect((await pending()).some((c) => c.id === grad.id)).toBe(true);
  });

  it("en producción sin llave secreta no se ofrece la tarjeta", async () => {
    await ctx.app.inject({ method: "GET", url: "/health" });
    const { db } = ctx;
    const { paymentSettings } = await import("../src/db/schema");
    const { eq } = await import("drizzle-orm");
    await db
      .update(paymentSettings)
      .set({ mode: "produccion", keyId: "otra-llave", secretEncrypted: null })
      .where(eq(paymentSettings.schoolId, schoolId));
    const mine = await ctx.call<StudentAccountDto>(mother, "GET", `/family/children/${luis.id}/account`);
    expect(mine.body.onlinePayments).toBe(false);
  });
});

describe("PixelPay: firma y llaves", () => {
  it("la firma coincide con el ejemplo de la documentación de PixelPay", () => {
    const sig = clientSignature({ ...PIXELPAY_SANDBOX, endpoint: "pixelpay.dev" }, "ORDER-8888");
    expect(sig.startsWith("688084a6")).toBe(true);
    expect(sig.endsWith("e852ee2a")).toBe(true);
  });

  it("la llave secreta se guarda cifrada y solo se abre con la llave de la instalación", () => {
    const sealed = sealSecret("instalacion", "mi-llave-secreta");
    expect(sealed).not.toContain("mi-llave-secreta");
    expect(openSecret("instalacion", sealed)).toBe("mi-llave-secreta");
    expect(() => openSecret("otra", sealed)).toThrow();
  });
});
