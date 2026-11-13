import type { DepartmentDto, TransferTargetDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type IdentityTestContext, PASSWORD, SUPERADMIN, setupIdentity } from "./helpers";

let ctx: IdentityTestContext;
let directorA: string;

beforeAll(async () => {
  ctx = await setupIdentity();
  const root = await ctx.tokenFor(SUPERADMIN.email, SUPERADMIN.password);
  const post = (url: string, payload: object) =>
    ctx.app.inject({ method: "POST", url, headers: ctx.auth(root), payload }).then((r) => r.json());
  const ihb = (await post("/departments", { code: "11", name: "Islas de la Bahía" })) as DepartmentDto;
  const fm = (await post("/departments", { code: "08", name: "Francisco Morazán" })) as DepartmentDto;
  const roatan = await post(`/departments/${ihb.id}/districts`, { name: "Roatán" });
  const utila = await post(`/departments/${ihb.id}/districts`, { name: "Utila" });
  const tegus = await post(`/departments/${fm.id}/districts`, { name: "Distrito Central" });
  for (const [slug, districtId] of [
    ["escuela-a", roatan.id],
    ["escuela-b", utila.id],
    ["escuela-tegus", tegus.id],
  ]) {
    await post("/schools", {
      name: slug,
      slug,
      sector: "publico",
      districtId,
      admin: { name: `Dirección ${slug}`, email: `director@${slug}.hn`, password: PASSWORD },
    });
  }
  directorA = await ctx.tokenFor("director@escuela-a.hn");
});
afterAll(() => ctx.close());

describe("centros a los que se puede trasladar", () => {
  it("son los del mismo departamento, sin el propio", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/schools/transfer-targets",
      headers: ctx.auth(directorA),
    });
    expect(res.json<TransferTargetDto[]>().map((s) => [s.name, s.districtName])).toEqual([
      ["escuela-b", "Utila"],
    ]);
  });
});
