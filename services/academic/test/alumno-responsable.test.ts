import { randomUUID } from "node:crypto";
import type {
  PaymentDto,
  SectionFamilyAccessDto,
  StudentAccessDto,
  StudentAccountDto,
  StudentDetailDto,
} from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PIXELPAY_SANDBOX, paymentHash } from "../src/lib/pixelpay";
import { type AcademicTestContext, guardian, setupAcademic, type TestUser } from "./helpers";

let ctx: AcademicTestContext;
let director: TestUser;
let secretary: TestUser;
let adult: StudentDetailDto;
let kid: StudentDetailDto;
let adultUser: TestUser;
let kidUser: TestUser;
let structure: Awaited<ReturnType<AcademicTestContext["seedStructure"]>>;
const schoolId = randomUUID();

beforeAll(async () => {
  ctx = await setupAcademic({ today: "2026-11-09" });
  director = await ctx.user("admin", schoolId, "Directora");
  secretary = await ctx.user("secretaria", schoolId, "Sofía Secretaria");
  structure = await ctx.seedStructure(director);
});
afterAll(() => ctx.close());

describe("alumno que responde por sí mismo", () => {
  it("sin responsables solo se puede matricular si responde por sí mismo", async () => {
    const without = await ctx.call(secretary, "POST", "/students", {
      firstNames: "Carlos",
      lastNames: "Mejía",
      guardians: [],
      sectionId: structure.sectionA.id,
    });
    expect(without.status).toBe(400);
    const res = await ctx.call<StudentDetailDto>(secretary, "POST", "/students", {
      firstNames: "Carlos",
      lastNames: "Mejía",
      nationalId: "0801199912345",
      birthDate: "1999-03-10",
      selfResponsible: true,
      guardians: [],
      sectionId: structure.sectionA.id,
    });
    expect(res.status).toBe(201);
    adult = res.body;
    expect(adult).toMatchObject({ selfResponsible: true, guardians: [] });
    kid = (
      await ctx.call<StudentDetailDto>(secretary, "POST", "/students", {
        firstNames: "Ana",
        lastNames: "Mejía",
        nationalId: "0801201105555",
        guardians: [guardian()],
        sectionId: structure.sectionA.id,
      })
    ).body;
  });

  it("no se le puede quitar «responde por sí mismo» sin agregar antes un responsable", async () => {
    const res = await ctx.call(secretary, "PUT", `/students/${adult.id}`, {
      firstNames: "Carlos",
      lastNames: "Mejía",
      nationalId: "0801199912345",
      selfResponsible: false,
    });
    expect(res.status).toBe(400);
    // Corregir otros datos sin mandar el campo lo deja como estaba.
    const keep = await ctx.call<StudentDetailDto>(secretary, "PUT", `/students/${adult.id}`, {
      firstNames: "Carlos Andrés",
      lastNames: "Mejía",
      nationalId: "0801199912345",
    });
    expect(keep.body.selfResponsible).toBe(true);
  });

  it("con su cuenta ve sus cobros y paga con tarjeta; un alumno con familia no", async () => {
    const access = async (s: StudentDetailDto) =>
      (await ctx.call<StudentAccessDto>(secretary, "POST", `/students/${s.id}/student-access`, {})).body;
    adultUser = await ctx.user("estudiante", schoolId, "Carlos Mejía", (await access(adult)).userId);
    kidUser = await ctx.user("estudiante", schoolId, "Ana Mejía", (await access(kid)).userId);

    await ctx.call(secretary, "POST", "/fees", {
      name: "Mensualidad de noviembre",
      amount: "950",
      dueOn: "2026-11-30",
      scope: "centro",
    });
    await ctx.call(director, "PUT", "/payment-settings", {
      enabled: true,
      mode: "sandbox",
      endpoint: "pixelpay.app",
      keyId: PIXELPAY_SANDBOX.keyId,
      secretKey: PIXELPAY_SANDBOX.secretKey,
    });

    expect((await ctx.call(kidUser, "GET", "/student/me/account")).status).toBe(404);
    const mine = await ctx.call<StudentAccountDto>(adultUser, "GET", "/student/me/account");
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ studentId: adult.id, pendingCents: 95_000, onlinePayments: true });

    const start = await ctx.call<{ orderId: string; fields: Record<string, string> }>(
      adultUser,
      "POST",
      "/student/me/pay",
      {
        chargeIds: mine.body.charges.map((c) => c.id),
        email: "carlos@correo.hn",
        returnBase: "https://conecta.test",
      },
    );
    expect(start.status).toBe(200);
    expect(start.body.fields).toMatchObject({ _amount: "950.00", _first_name: "Carlos" });
    expect((await ctx.call(kidUser, "POST", "/student/me/pay", {})).status).toBe(404);

    const done = await ctx.call<{ status: string; paymentId: string }>(
      adultUser,
      "POST",
      "/payments/online/complete",
      { orderId: start.body.orderId, paymentHash: paymentHash(PIXELPAY_SANDBOX, start.body.orderId) },
    );
    expect(done.body.status).toBe("confirmado");
    const receipt = await ctx.call<PaymentDto>(adultUser, "GET", `/payments/${done.body.paymentId}`);
    expect(receipt.status).toBe(200);
    expect(receipt.body.studentName).toContain("Carlos");
    // Otro alumno no ve ese recibo.
    expect((await ctx.call(kidUser, "GET", `/payments/${done.body.paymentId}`)).status).toBe(404);
  });

  it("al dar acceso a las familias de la sección no aparece como pendiente", async () => {
    const res = await ctx.call<SectionFamilyAccessDto>(
      secretary,
      "POST",
      `/sections/${structure.sectionA.id}/portal-access`,
      {},
    );
    expect(res.body.selfResponsible).toBe(1);
    expect(res.body.skipped.map((s) => s.studentName)).not.toContain("Carlos Andrés Mejía");
  });
});
