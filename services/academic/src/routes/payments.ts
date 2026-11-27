import { randomBytes } from "node:crypto";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  parseOrThrow,
  requireRole,
  tenantOf,
} from "@escolar/service-kit";
import {
  type BalanceRowDto,
  type ChargeDto,
  type FeeDto,
  type FeeScope,
  feeInputSchema,
  officePaymentInputSchema,
  onlinePaymentInputSchema,
  type PaymentDto,
  type PaymentMethod,
  type PaymentSettingsDto,
  type PaymentStatus,
  paymentSettingsInputSchema,
  type StudentAccountDto,
  voidPaymentSchema,
} from "@escolar/shared";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { DbOrTx } from "../db/client";
import {
  auditEvents,
  enrollments,
  feeItems,
  grades,
  type Payment,
  paymentItems,
  paymentSettings,
  payments,
  sections,
  studentCharges,
  students,
} from "../db/schema";
import type { AcademicDeps } from "../deps";
import { audit } from "../lib/audit";
import { childrenOf, studentOf } from "../lib/family";
import {
  type GatewayAccount,
  type HostedForm,
  hostedPaymentForm,
  openSecret,
  PIXELPAY_SANDBOX,
  sealSecret,
  verifyPaymentHash,
} from "../lib/pixelpay";
import { findCurrentYear, sectionLabel } from "../lib/queries";

const idParams = z.object({ id: z.uuid() });
const schoolParams = z.object({ schoolId: z.uuid() });
const balanceQuery = z.object({ sectionId: z.uuid().optional() });
const completeSchema = z.object({
  orderId: z.string().min(4).max(40),
  paymentHash: z.string().max(200).optional(),
  cancelled: z.boolean().optional(),
});
/** Lo que manda PixelPay a `_callback` (solo los campos que se usan). */
const callbackSchema = z.object({
  order: z.string().min(1).max(40),
  payment_hash: z.string().min(1).max(200),
  status: z.string().optional(),
  amount: z.coerce.number().optional(),
  currency: z.string().optional(),
  uuid: z.string().max(100).optional(),
});

const todayIso = (today: () => string) => today();
/** Minutos que un pago con tarjeta abierto «aparta» sus cobros (la persona está en la página de pago). */
const ONLINE_HOLD_MINUTES = 30;

/**
 * Pagos de las familias al centro: cobros (por centro, grado, sección o alumno), estado de cuenta, pagos
 * en la oficina y con tarjeta en línea (PixelPay Hosted Payment), recibos numerados.
 */
export async function paymentRoutes(app: FastifyInstance, deps: AcademicDeps) {
  const { db, paymentsKey } = deps;
  const office = { preHandler: [app.authenticate, requireRole("admin", "secretaria")] };
  const director = { preHandler: [app.authenticate, requireRole("admin")] };
  const family = { preHandler: [app.authenticate, requireRole("padre")] };
  const anyone = {
    preHandler: [app.authenticate, requireRole("padre", "estudiante", "admin", "secretaria")],
  };
  const student = { preHandler: [app.authenticate, requireRole("estudiante")] };

  // ── Ayudantes ──
  const studentName = (s: { firstNames: string; lastNames: string }) => `${s.firstNames} ${s.lastNames}`;

  /** Sección actual (año vigente) de cada alumno. */
  async function currentSections(tx: DbOrTx, schoolId: string, studentIds: string[]) {
    const year = await findCurrentYear(tx, schoolId);
    if (!year || !studentIds.length) return new Map<string, { id: string; label: string }>();
    const rows = await tx
      .select({ studentId: enrollments.studentId, id: sections.id, name: sections.name, grade: grades.name })
      .from(enrollments)
      .innerJoin(sections, eq(sections.id, enrollments.sectionId))
      .innerJoin(grades, eq(grades.id, sections.gradeId))
      .where(
        and(
          eq(enrollments.schoolYearId, year.id),
          eq(enrollments.status, "activa"),
          inArray(enrollments.studentId, studentIds),
        ),
      );
    return new Map(rows.map((r) => [r.studentId, { id: r.id, label: sectionLabel(r.grade, r.name) }]));
  }

  async function studentOrThrow(tx: DbOrTx, schoolId: string, id: string) {
    const [student] = await tx
      .select()
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.id, id)));
    if (!student) throw notFound("Alumno no encontrado");
    return student;
  }

  async function paymentDtos(tx: DbOrTx, schoolId: string, rows: Payment[]): Promise<PaymentDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((p) => p.id);
    const studentIds = [...new Set(rows.map((p) => p.studentId))];
    const [items, people, sectionsOf] = await Promise.all([
      tx.select().from(paymentItems).where(inArray(paymentItems.paymentId, ids)),
      tx.select().from(students).where(inArray(students.id, studentIds)),
      currentSections(tx, schoolId, studentIds),
    ]);
    const nameOf = new Map(people.map((s) => [s.id, studentName(s)]));
    return rows.map((p) => ({
      id: p.id,
      studentId: p.studentId,
      studentName: nameOf.get(p.studentId) ?? "Alumno",
      sectionLabel: sectionsOf.get(p.studentId)?.label ?? null,
      receiptNumber: p.receiptNumber,
      amountCents: p.amountCents,
      method: p.method as PaymentMethod,
      reference: p.reference,
      status: p.status as PaymentStatus,
      byName: p.byName,
      createdAt: p.createdAt.toISOString(),
      confirmedAt: p.confirmedAt?.toISOString() ?? null,
      voidReason: p.voidReason,
      items: items
        .filter((i) => i.paymentId === p.id)
        .map((i) => ({ name: i.name, amountCents: i.amountCents })),
    }));
  }

  async function settingsOf(tx: DbOrTx, schoolId: string) {
    const [row] = await tx.select().from(paymentSettings).where(eq(paymentSettings.schoolId, schoolId));
    return row ?? null;
  }

  /** La cuenta de PixelPay del centro, con la llave abierta (solo en memoria, para firmar). */
  async function gatewayAccount(tx: DbOrTx, schoolId: string): Promise<GatewayAccount | null> {
    const row = await settingsOf(tx, schoolId);
    if (!row?.enabled) return null;
    const mode = row.mode === "produccion" ? "produccion" : "sandbox";
    if (row.secretEncrypted && paymentsKey) {
      return {
        mode,
        endpoint: row.endpoint,
        keyId: row.keyId,
        secretKey: openSecret(paymentsKey, row.secretEncrypted),
      };
    }
    // Sin llave propia, el modo de prueba usa las llaves públicas del sandbox de PixelPay.
    if (mode === "sandbox" && row.keyId === PIXELPAY_SANDBOX.keyId) {
      return { mode, endpoint: row.endpoint, keyId: row.keyId, secretKey: PIXELPAY_SANDBOX.secretKey };
    }
    return null;
  }

  async function account(tx: DbOrTx, schoolId: string, studentId: string): Promise<StudentAccountDto> {
    const student = await studentOrThrow(tx, schoolId, studentId);
    const today = todayIso(deps.today);
    const [charges, paymentRows, sectionsOf, gateway] = await Promise.all([
      tx
        .select({ charge: studentCharges, name: feeItems.name })
        .from(studentCharges)
        .innerJoin(feeItems, eq(feeItems.id, studentCharges.feeItemId))
        .where(and(eq(studentCharges.schoolId, schoolId), eq(studentCharges.studentId, studentId)))
        .orderBy(asc(studentCharges.dueOn), asc(feeItems.name)),
      tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.schoolId, schoolId),
            eq(payments.studentId, studentId),
            inArray(payments.status, ["confirmado", "anulado"]),
          ),
        )
        .orderBy(desc(payments.createdAt))
        .limit(50),
      currentSections(tx, schoolId, [studentId]),
      // Solo se ofrece la tarjeta si la cuenta de PixelPay del centro sirve de verdad (con su llave).
      gatewayAccount(tx, schoolId).catch(() => null),
    ]);
    const chargeDtos: ChargeDto[] = charges.map(({ charge, name }) => ({
      id: charge.id,
      feeId: charge.feeItemId,
      name,
      amountCents: charge.amountCents,
      dueOn: charge.dueOn,
      status: charge.status as ChargeDto["status"],
      overdue: charge.status === "pendiente" && charge.dueOn < today,
      paidAt: charge.paidAt?.toISOString() ?? null,
      paymentId: charge.paymentId,
    }));
    const pending = chargeDtos.filter((c) => c.status === "pendiente");
    return {
      studentId,
      studentName: studentName(student),
      sectionLabel: sectionsOf.get(studentId)?.label ?? null,
      charges: chargeDtos.filter((c) => c.status !== "anulado"),
      payments: await paymentDtos(tx, schoolId, paymentRows),
      pendingCents: pending.reduce((sum, c) => sum + c.amountCents, 0),
      overdueCents: pending.filter((c) => c.overdue).reduce((sum, c) => sum + c.amountCents, 0),
      onlinePayments: gateway !== null,
    };
  }

  /**
   * Pagos con tarjeta todavía abiertos (la persona está en la página de PixelPay) que incluyen alguno de
   * esos cobros. Pasada media hora se dan por abandonados.
   */
  async function onlineInFlight(tx: DbOrTx, schoolId: string, chargeIds: string[]) {
    if (!chargeIds.length) return [];
    return tx
      .select({ id: payments.id, byUserId: payments.byUserId, byName: payments.byName })
      .from(payments)
      .innerJoin(paymentItems, eq(paymentItems.paymentId, payments.id))
      .where(
        and(
          eq(payments.schoolId, schoolId),
          eq(payments.status, "pendiente"),
          eq(payments.method, "tarjeta"),
          inArray(paymentItems.chargeId, chargeIds),
          sql`${payments.createdAt} > now() - interval '${sql.raw(String(ONLINE_HOLD_MINUTES))} minutes'`,
        ),
      );
  }

  /** Cargos pendientes del alumno (todos los pedidos deben serlo). */
  async function pendingCharges(tx: DbOrTx, schoolId: string, studentId: string, chargeIds: string[]) {
    const rows = await tx
      .select({ charge: studentCharges, name: feeItems.name })
      .from(studentCharges)
      .innerJoin(feeItems, eq(feeItems.id, studentCharges.feeItemId))
      .where(
        and(
          eq(studentCharges.schoolId, schoolId),
          eq(studentCharges.studentId, studentId),
          inArray(studentCharges.id, chargeIds),
        ),
      )
      .for("update", { of: studentCharges });
    if (rows.length !== new Set(chargeIds).size) throw notFound("Cobro no encontrado");
    if (rows.some((r) => r.charge.status !== "pendiente"))
      throw conflict("Alguno de esos cobros ya no está pendiente");
    return rows;
  }

  /** Siguiente número de recibo del centro (uno a la vez por centro). */
  async function nextReceipt(tx: DbOrTx, schoolId: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`recibo:${schoolId}`}))`);
    const [row] = await tx
      .select({ last: sql<number>`coalesce(max(${payments.receiptNumber}), 0)::int` })
      .from(payments)
      .where(eq(payments.schoolId, schoolId));
    return (row?.last ?? 0) + 1;
  }

  async function markPaid(tx: DbOrTx, payment: Payment) {
    const items = await tx.select().from(paymentItems).where(eq(paymentItems.paymentId, payment.id));
    await tx
      .update(studentCharges)
      .set({ status: "pagado", paymentId: payment.id, paidAt: new Date() })
      .where(
        and(
          inArray(
            studentCharges.id,
            items.map((i) => i.chargeId),
          ),
          eq(studentCharges.status, "pendiente"),
        ),
      );
  }

  // ── Cobros ──
  app.get("/fees", office, async (request): Promise<FeeDto[]> => {
    const schoolId = tenantOf(request);
    const rows = await db
      .select({
        fee: feeItems,
        charges: sql<number>`count(${studentCharges.id}) filter (where ${studentCharges.status} <> 'anulado')::int`,
        paid: sql<number>`count(${studentCharges.id}) filter (where ${studentCharges.status} = 'pagado')::int`,
        collected: sql<number>`coalesce(sum(${studentCharges.amountCents}) filter (where ${studentCharges.status} = 'pagado'), 0)::int`,
        pending: sql<number>`coalesce(sum(${studentCharges.amountCents}) filter (where ${studentCharges.status} = 'pendiente'), 0)::int`,
      })
      .from(feeItems)
      .leftJoin(studentCharges, eq(studentCharges.feeItemId, feeItems.id))
      .where(eq(feeItems.schoolId, schoolId))
      .groupBy(feeItems.id)
      .orderBy(desc(feeItems.dueOn), desc(feeItems.createdAt))
      .limit(300);
    return rows.map(({ fee, charges, paid, collected, pending }) => ({
      id: fee.id,
      name: fee.name,
      amountCents: fee.amountCents,
      dueOn: fee.dueOn,
      scope: fee.scope as FeeScope,
      scopeLabel: fee.scopeLabel,
      createdByName: fee.createdByName,
      createdAt: fee.createdAt.toISOString(),
      cancelled: fee.cancelledAt !== null,
      charges,
      paid,
      collectedCents: collected,
      pendingCents: pending,
    }));
  });

  /** Crea el cobro y un cargo para cada alumno matriculado en su alcance. */
  app.post("/fees", office, async (request, reply) => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(feeInputSchema, request.body);
    const year = await findCurrentYear(db, schoolId);
    if (!year) throw badRequest("Primero configura el año lectivo vigente");
    const active = and(eq(enrollments.schoolYearId, year.id), eq(enrollments.status, "activa"));
    let studentIds: string[];
    let scopeLabel = "Todo el centro";
    if (input.scope === "alumno") {
      const student = await studentOrThrow(db, schoolId, input.targetId as string);
      studentIds = [student.id];
      scopeLabel = studentName(student);
    } else {
      const filter =
        input.scope === "seccion"
          ? eq(enrollments.sectionId, input.targetId as string)
          : input.scope === "grado"
            ? eq(sections.gradeId, input.targetId as string)
            : undefined;
      const rows = await db
        .select({ studentId: enrollments.studentId })
        .from(enrollments)
        .innerJoin(sections, eq(sections.id, enrollments.sectionId))
        .where(and(eq(enrollments.schoolId, schoolId), active, filter));
      studentIds = rows.map((r) => r.studentId);
      if (input.scope === "seccion") {
        const [s] = await db
          .select({ name: sections.name, grade: grades.name })
          .from(sections)
          .innerJoin(grades, eq(grades.id, sections.gradeId))
          .where(and(eq(sections.schoolId, schoolId), eq(sections.id, input.targetId as string)));
        if (!s) throw notFound("Sección no encontrada");
        scopeLabel = sectionLabel(s.grade, s.name);
      } else if (input.scope === "grado") {
        const [g] = await db
          .select({ name: grades.name })
          .from(grades)
          .where(and(eq(grades.schoolId, schoolId), eq(grades.id, input.targetId as string)));
        if (!g) throw notFound("Grado no encontrado");
        scopeLabel = g.name;
      }
    }
    if (!studentIds.length) throw badRequest("No hay alumnos matriculados a quienes cobrar");
    const fee = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(feeItems)
        .values({
          schoolId,
          schoolYearId: year.id,
          name: input.name,
          amountCents: input.amount,
          dueOn: input.dueOn,
          scope: input.scope,
          targetId: input.targetId ?? null,
          scopeLabel,
          createdByUserId: request.auth.userId,
          createdByName: request.auth.name,
        })
        .returning();
      if (!created) throw new Error("No se creó el cobro");
      await tx.insert(studentCharges).values(
        studentIds.map((studentId) => ({
          schoolId,
          feeItemId: created.id,
          studentId,
          amountCents: input.amount,
          dueOn: input.dueOn,
        })),
      );
      await audit(tx, request, {
        action: "fee.created",
        entityType: "fee",
        entityId: created.id,
        data: { name: input.name, amountCents: input.amount, scope: scopeLabel, students: studentIds.length },
      });
      return created;
    });
    return reply.status(201).send({ id: fee.id, students: studentIds.length, scopeLabel });
  });

  /** Anular un cobro: sus cargos pendientes desaparecen; lo ya pagado queda pagado. */
  app.post("/fees/:id/cancel", director, async (request) => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    await db.transaction(async (tx) => {
      const [fee] = await tx
        .update(feeItems)
        .set({ cancelledAt: new Date() })
        .where(and(eq(feeItems.schoolId, schoolId), eq(feeItems.id, id), isNull(feeItems.cancelledAt)))
        .returning();
      if (!fee) throw notFound("Cobro no encontrado o ya anulado");
      await tx
        .update(studentCharges)
        .set({ status: "anulado" })
        .where(and(eq(studentCharges.feeItemId, id), eq(studentCharges.status, "pendiente")));
      await audit(tx, request, {
        action: "fee.cancelled",
        entityType: "fee",
        entityId: id,
        data: { name: fee.name },
      });
    });
    return { ok: true };
  });

  // ── Estado de cuenta y quién debe ──
  app.get("/students/:id/account", office, async (request): Promise<StudentAccountDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    return account(db, tenantOf(request), id);
  });

  app.get("/payments/balances", office, async (request): Promise<BalanceRowDto[]> => {
    const schoolId = tenantOf(request);
    const { sectionId } = parseOrThrow(balanceQuery, request.query);
    const today = todayIso(deps.today);
    const rows = await db
      .select({
        studentId: studentCharges.studentId,
        firstNames: students.firstNames,
        lastNames: students.lastNames,
        pending: sql<number>`sum(${studentCharges.amountCents})::int`,
        overdue: sql<number>`coalesce(sum(${studentCharges.amountCents}) filter (where ${studentCharges.dueOn} < ${today}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(studentCharges)
      .innerJoin(students, eq(students.id, studentCharges.studentId))
      .where(and(eq(studentCharges.schoolId, schoolId), eq(studentCharges.status, "pendiente")))
      .groupBy(studentCharges.studentId, students.firstNames, students.lastNames)
      .orderBy(asc(students.lastNames), asc(students.firstNames));
    const sectionsOf = await currentSections(
      db,
      schoolId,
      rows.map((r) => r.studentId),
    );
    return rows
      .map((r) => {
        const section = sectionsOf.get(r.studentId);
        return {
          studentId: r.studentId,
          studentName: `${r.firstNames} ${r.lastNames}`,
          sectionId: section?.id ?? null,
          sectionLabel: section?.label ?? null,
          pendingCents: r.pending,
          overdueCents: r.overdue,
          pendingCharges: r.count,
        };
      })
      .filter((r) => !sectionId || r.sectionId === sectionId);
  });

  // ── Pagos en la oficina ──
  app.get("/payments", office, async (request): Promise<PaymentDto[]> => {
    const schoolId = tenantOf(request);
    const rows = await db
      .select()
      .from(payments)
      .where(and(eq(payments.schoolId, schoolId), inArray(payments.status, ["confirmado", "anulado"])))
      .orderBy(desc(payments.confirmedAt))
      .limit(100);
    return paymentDtos(db, schoolId, rows);
  });

  app.post("/payments", office, async (request, reply): Promise<PaymentDto> => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(officePaymentInputSchema, request.body);
    await studentOrThrow(db, schoolId, input.studentId);
    const payment = await db.transaction(async (tx) => {
      const charges = await pendingCharges(tx, schoolId, input.studentId, input.chargeIds);
      const inFlight = await onlineInFlight(tx, schoolId, input.chargeIds);
      if (inFlight.length) {
        throw conflict(
          `${inFlight[0]?.byName ?? "La familia"} está pagando ese cobro con tarjeta en este momento. Espera unos minutos y vuelve a abrir el estado de cuenta para no cobrarlo dos veces.`,
        );
      }
      const receiptNumber = await nextReceipt(tx, schoolId);
      const [created] = await tx
        .insert(payments)
        .values({
          schoolId,
          studentId: input.studentId,
          receiptNumber,
          amountCents: charges.reduce((sum, r) => sum + r.charge.amountCents, 0),
          method: input.method,
          reference: input.reference ?? null,
          status: "confirmado",
          byUserId: request.auth.userId,
          byName: request.auth.name,
          confirmedAt: new Date(),
        })
        .returning();
      if (!created) throw new Error("No se registró el pago");
      await tx.insert(paymentItems).values(
        charges.map((r) => ({
          paymentId: created.id,
          chargeId: r.charge.id,
          name: r.name,
          amountCents: r.charge.amountCents,
        })),
      );
      await markPaid(tx, created);
      await audit(tx, request, {
        action: "payment.recorded",
        entityType: "payment",
        entityId: created.id,
        data: { receiptNumber, amountCents: created.amountCents, method: input.method },
      });
      return created;
    });
    const [dto] = await paymentDtos(db, schoolId, [payment]);
    return reply.status(201).send(dto);
  });

  /** El recibo: la oficina, o la familia si es de su hijo. */
  app.get("/payments/:id", anyone, async (request): Promise<PaymentDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const [row] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.schoolId, schoolId), eq(payments.id, id)));
    if (!row || row.status === "pendiente" || row.status === "fallido")
      throw notFound("Recibo no encontrado");
    if (
      request.auth.role === "padre" &&
      !(await childrenOf(db, schoolId, request.auth.userId)).includes(row.studentId)
    ) {
      throw notFound("Recibo no encontrado");
    }
    if (
      request.auth.role === "estudiante" &&
      (await studentOf(db, schoolId, request.auth.userId)) !== row.studentId
    ) {
      throw notFound("Recibo no encontrado");
    }
    const [dto] = await paymentDtos(db, schoolId, [row]);
    if (!dto) throw notFound("Recibo no encontrado");
    return dto;
  });

  /** Anular un pago mal registrado: los cobros vuelven a quedar pendientes (no devuelve dinero). */
  app.post("/payments/:id/void", director, async (request): Promise<PaymentDto> => {
    const schoolId = tenantOf(request);
    const { id } = parseOrThrow(idParams, request.params);
    const { reason } = parseOrThrow(voidPaymentSchema, request.body);
    const voided = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(payments)
        .set({ status: "anulado", voidedAt: new Date(), voidReason: reason })
        .where(and(eq(payments.schoolId, schoolId), eq(payments.id, id), eq(payments.status, "confirmado")))
        .returning();
      if (!row) throw notFound("Pago confirmado no encontrado");
      await tx
        .update(studentCharges)
        .set({ status: "pendiente", paymentId: null, paidAt: null })
        .where(and(eq(studentCharges.paymentId, id), eq(studentCharges.status, "pagado")));
      await audit(tx, request, {
        action: "payment.voided",
        entityType: "payment",
        entityId: id,
        data: { receiptNumber: row.receiptNumber, reason },
      });
      return row;
    });
    const [dto] = await paymentDtos(db, schoolId, [voided]);
    if (!dto) throw new Error("No se encontró el pago anulado");
    return dto;
  });

  // ── Familias ──
  async function childOrThrow(request: FastifyRequest, studentId: string) {
    const schoolId = tenantOf(request);
    if (!(await childrenOf(db, schoolId, request.auth.userId)).includes(studentId)) {
      throw notFound("Alumno no encontrado");
    }
    return schoolId;
  }

  app.get("/family/children/:id/account", family, async (request): Promise<StudentAccountDto> => {
    const { id } = parseOrThrow(idParams, request.params);
    return account(db, await childOrThrow(request, id), id);
  });

  /**
   * Pagar con tarjeta: se guarda el pago «pendiente» con su número de orden y se pide a PixelPay la
   * página de pago. La familia (o el alumno que responde por sí mismo) vuelve a `_complete`; PixelPay
   * además avisa a `_callback`.
   */
  app.post("/family/children/:id/pay", family, async (request): Promise<HostedForm & { orderId: string }> => {
    const { id } = parseOrThrow(idParams, request.params);
    return startOnline(request, await childOrThrow(request, id), id);
  });

  // ── Alumno que responde por sí mismo (mayor de edad, o paga él su colegiatura) ──
  async function selfOrThrow(request: FastifyRequest) {
    const schoolId = tenantOf(request);
    const studentId = await studentOf(db, schoolId, request.auth.userId);
    if (!studentId) throw notFound("Tu cuenta no está ligada a un alumno del centro");
    const [row] = await db
      .select({ selfResponsible: students.selfResponsible })
      .from(students)
      .where(eq(students.id, studentId));
    if (!row?.selfResponsible) throw notFound("Tus pagos los ve tu familia desde su cuenta");
    return { schoolId, studentId };
  }

  app.get("/student/me/account", student, async (request): Promise<StudentAccountDto> => {
    const { schoolId, studentId } = await selfOrThrow(request);
    return account(db, schoolId, studentId);
  });

  app.post("/student/me/pay", student, async (request): Promise<HostedForm & { orderId: string }> => {
    const { schoolId, studentId } = await selfOrThrow(request);
    return startOnline(request, schoolId, studentId);
  });

  async function startOnline(
    request: FastifyRequest,
    schoolId: string,
    id: string,
  ): Promise<HostedForm & { orderId: string }> {
    const input = parseOrThrow(onlinePaymentInputSchema, request.body);
    const gateway = await gatewayAccount(db, schoolId);
    if (!gateway) throw conflict("El centro todavía no recibe pagos con tarjeta");
    const orderId = `CN${Date.now().toString(36)}${randomBytes(3).toString("hex")}`.toUpperCase();
    const { payment, items } = await db.transaction(async (tx) => {
      const charges = await pendingCharges(tx, schoolId, id, input.chargeIds);
      // Un intento anterior que quedó abierto (cerró la página de pago sin terminar) se da por
      // abandonado. Si aun así se pagara, al confirmarse se marca como pago doble.
      const previous = await onlineInFlight(tx, schoolId, input.chargeIds);
      if (previous.length) {
        await tx
          .update(payments)
          .set({ status: "fallido" })
          .where(
            and(
              inArray(
                payments.id,
                previous.map((p) => p.id),
              ),
              eq(payments.status, "pendiente"),
            ),
          );
      }
      const [created] = await tx
        .insert(payments)
        .values({
          schoolId,
          studentId: id,
          amountCents: charges.reduce((sum, r) => sum + r.charge.amountCents, 0),
          method: "tarjeta",
          status: "pendiente",
          orderId,
          byUserId: request.auth.userId,
          byName: request.auth.name,
        })
        .returning();
      if (!created) throw new Error("No se creó el pago");
      const rows = charges.map((r) => ({
        paymentId: created.id,
        chargeId: r.charge.id,
        name: r.name,
        amountCents: r.charge.amountCents,
      }));
      await tx.insert(paymentItems).values(rows);
      return { payment: created, items: rows };
    });
    const base = input.returnBase.replace(/\/+$/, "");
    const words = request.auth.name.trim().split(/\s+/);
    const first = (words[0] ?? "").length >= 3 ? (words[0] as string) : request.auth.name;
    const last = words.length > 1 ? (words.at(-1) as string) : "Familia";
    const form = hostedPaymentForm(gateway, {
      orderId,
      amountCents: payment.amountCents,
      items: items.map((i) => ({ title: i.name, amountCents: i.amountCents })),
      firstName: first,
      lastName: last.length >= 2 ? last : "Familia",
      email: input.email,
      // Regreso a una página pública: en la app, el pago se hace en el navegador del teléfono (sin la
      // sesión de CONECTA) y el pago se confirma igual con el paymentHash.
      completeUrl: `${base}/pagos/volver/${schoolId}?orden=${orderId}`,
      cancelUrl: `${base}/pagos/volver/${schoolId}?orden=${orderId}&cancelado=1`,
      callbackUrl: `${base}/api/pagos/pixelpay/${schoolId}`,
    });
    await audit(db, request, {
      action: "payment.online_started",
      entityType: "payment",
      entityId: payment.id,
      data: { orderId, amountCents: payment.amountCents },
    });
    return { ...form, orderId };
  }

  /** Confirma un pago en línea (idempotente: el regreso y el aviso pueden llegar los dos). */
  async function confirmOnline(schoolId: string, orderId: string, gatewayUuid: string | null) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.schoolId, schoolId), eq(payments.orderId, orderId)))
        .for("update");
      if (!row) throw notFound("Pago no encontrado");
      if (row.status === "confirmado" || row.status === "anulado") return row;
      // El banco ya cobró: el pago se confirma siempre. Si alguno de sus cobros ya estaba pagado (en la
      // oficina o con otro intento) o se anuló mientras tanto, queda marcado para devolver el dinero.
      const items = await tx.select().from(paymentItems).where(eq(paymentItems.paymentId, row.id));
      const charges = items.length
        ? await tx
            .select({ id: studentCharges.id, status: studentCharges.status })
            .from(studentCharges)
            .where(
              inArray(
                studentCharges.id,
                items.map((i) => i.chargeId),
              ),
            )
            .for("update")
        : [];
      const taken = charges.filter((c) => c.status !== "pendiente");
      const duplicate = taken.length > 0;
      const receiptNumber = await nextReceipt(tx, schoolId);
      const [confirmed] = await tx
        .update(payments)
        .set({
          status: "confirmado",
          receiptNumber,
          confirmedAt: new Date(),
          gatewayUuid,
          reference: duplicate
            ? `PAGO DOBLE: ${taken.length === items.length ? "todo" : "parte de"} lo cobrado ya estaba pagado o anulado. Revisar devolución.`
            : row.reference,
        })
        .where(eq(payments.id, row.id))
        .returning();
      if (!confirmed) throw new Error("No se confirmó el pago");
      await markPaid(tx, confirmed);
      // Lo confirma la pasarela (no hay una persona en sesión): queda en la bitácora sin autor.
      await tx.insert(auditEvents).values({
        schoolId,
        action: duplicate ? "payment.online_duplicate" : "payment.online_confirmed",
        entityType: "payment",
        entityId: confirmed.id,
        data: { orderId, receiptNumber, amountCents: confirmed.amountCents, alreadyPaid: taken.length },
      });
      return confirmed;
    });
  }

  /** La familia vuelve de PixelPay: si trae el hash correcto, el pago queda confirmado. */
  app.post("/payments/online/complete", anyone, async (request) => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(completeSchema, request.body);
    const [row] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.schoolId, schoolId), eq(payments.orderId, input.orderId)));
    if (!row) throw notFound("Pago no encontrado");
    if (
      (request.auth.role === "padre" || request.auth.role === "estudiante") &&
      row.byUserId !== request.auth.userId
    )
      throw notFound("Pago no encontrado");
    if (input.cancelled || !input.paymentHash) {
      if (row.status === "pendiente")
        await db.update(payments).set({ status: "fallido" }).where(eq(payments.id, row.id));
      return {
        status: row.status === "confirmado" ? "confirmado" : "cancelado",
        paymentId: row.id,
        studentId: row.studentId,
      };
    }
    const gateway = await gatewayAccount(db, schoolId);
    if (!gateway || !verifyPaymentHash(gateway, input.orderId, input.paymentHash)) {
      throw forbidden("No se pudo verificar el pago con PixelPay");
    }
    const confirmed = await confirmOnline(schoolId, input.orderId, null);
    return { status: confirmed.status, paymentId: confirmed.id, studentId: confirmed.studentId };
  });

  /**
   * Regreso desde PixelPay a la página pública de CONECTA (`_complete` / `_cancel`). No pide sesión:
   * en la app el pago se hace en el navegador del teléfono, donde la persona no tiene sesión. Lo que lo
   * hace confiable es el `paymentHash` (solo se arma con la llave secreta); sin él solo se puede marcar
   * como cancelado un intento todavía abierto, y si después PixelPay avisa que se pagó, se confirma igual.
   */
  app.post("/payments/online/return/:schoolId", async (request) => {
    const { schoolId } = parseOrThrow(schoolParams, request.params);
    const input = parseOrThrow(completeSchema, request.body);
    const [row] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.schoolId, schoolId), eq(payments.orderId, input.orderId)));
    if (!row) throw notFound("Pago no encontrado");
    const summary = (p: Payment, status: "confirmado" | "cancelado" | "pendiente") => ({
      status,
      paymentId: p.id,
      receiptNumber: p.receiptNumber,
      amountCents: p.amountCents,
      duplicate: Boolean(p.reference?.startsWith("PAGO DOBLE")),
    });
    if (input.cancelled || !input.paymentHash) {
      if (row.status === "pendiente")
        await db
          .update(payments)
          .set({ status: "fallido" })
          .where(and(eq(payments.id, row.id), eq(payments.status, "pendiente")));
      return summary(row, row.status === "confirmado" ? "confirmado" : "cancelado");
    }
    const gateway = await gatewayAccount(db, schoolId);
    if (!gateway || !verifyPaymentHash(gateway, input.orderId, input.paymentHash)) {
      throw forbidden("No se pudo verificar el pago con PixelPay");
    }
    const confirmed = await confirmOnline(schoolId, input.orderId, null);
    return summary(confirmed, confirmed.status === "confirmado" ? "confirmado" : "pendiente");
  });

  /**
   * Aviso de PixelPay (`_callback`). Llega por la web (CONECTA no expone este servicio a internet) sin
   * sesión: lo que lo hace confiable es el `payment_hash`, que solo se arma con la llave secreta.
   */
  app.post("/payments/pixelpay/callback/:schoolId", async (request) => {
    const { schoolId } = parseOrThrow(schoolParams, request.params);
    const body = parseOrThrow(callbackSchema, request.body);
    const gateway = await gatewayAccount(db, schoolId);
    if (!gateway || !verifyPaymentHash(gateway, body.order, body.payment_hash)) {
      throw forbidden("Aviso de pago no válido");
    }
    if (body.status && body.status !== "paid") return { ok: true, ignored: body.status };
    const [row] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.schoolId, schoolId), eq(payments.orderId, body.order)));
    if (!row) throw notFound("Pago no encontrado");
    if (body.amount !== undefined && Math.round(body.amount * 100) !== row.amountCents) {
      throw badRequest("El monto pagado no coincide con el cobro");
    }
    if (body.currency && body.currency.toUpperCase() !== "HNL")
      throw badRequest("Moneda distinta a lempiras");
    await confirmOnline(schoolId, body.order, body.uuid ?? null);
    return { ok: true };
  });

  // ── Configuración de la pasarela (dirección) ──
  app.get("/payment-settings", director, async (request): Promise<PaymentSettingsDto> => {
    const row = await settingsOf(db, tenantOf(request));
    return {
      enabled: row?.enabled ?? false,
      mode: row?.mode === "produccion" ? "produccion" : "sandbox",
      endpoint: row?.endpoint ?? PIXELPAY_SANDBOX.endpoint,
      keyId: row?.keyId ?? PIXELPAY_SANDBOX.keyId,
      hasSecret: Boolean(row?.secretEncrypted),
      canStoreSecrets: Boolean(paymentsKey),
    };
  });

  app.put("/payment-settings", director, async (request): Promise<PaymentSettingsDto> => {
    const schoolId = tenantOf(request);
    const input = parseOrThrow(paymentSettingsInputSchema, request.body);
    const current = await settingsOf(db, schoolId);
    if (input.secretKey && !paymentsKey) {
      throw conflict("Esta instalación no tiene la llave para guardar contraseñas de la pasarela");
    }
    const secretEncrypted =
      input.secretKey && paymentsKey
        ? sealSecret(paymentsKey, input.secretKey)
        : (current?.secretEncrypted ?? null);
    const sandboxKeys = input.mode === "sandbox" && input.keyId === PIXELPAY_SANDBOX.keyId;
    if (input.enabled && !secretEncrypted && !sandboxKeys) {
      throw badRequest("Escribe la llave secreta (Secret Key) de PixelPay", {
        fields: [{ path: "secretKey", message: "Escribe la llave secreta" }],
      });
    }
    const values = {
      enabled: input.enabled,
      mode: input.mode,
      endpoint: input.endpoint,
      keyId: input.keyId,
      secretEncrypted,
      updatedByUserId: request.auth.userId,
      updatedAt: new Date(),
    };
    await db.transaction(async (tx) => {
      await tx
        .insert(paymentSettings)
        .values({ schoolId, ...values })
        .onConflictDoUpdate({ target: paymentSettings.schoolId, set: values });
      // En la bitácora va qué se cambió, nunca la llave.
      await audit(tx, request, {
        action: "payment_settings.updated",
        data: {
          enabled: input.enabled,
          mode: input.mode,
          endpoint: input.endpoint,
          newSecret: Boolean(input.secretKey),
        },
      });
    });
    return {
      enabled: input.enabled,
      mode: input.mode,
      endpoint: input.endpoint,
      keyId: input.keyId,
      hasSecret: Boolean(secretEncrypted),
      canStoreSecrets: Boolean(paymentsKey),
    };
  });
}
