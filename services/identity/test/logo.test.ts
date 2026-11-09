import type { SchoolDto } from "@escolar/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type IdentityTestContext, PASSWORD, SUPERADMIN, setupIdentity } from "./helpers";

let ctx: IdentityTestContext;
let school: { schoolId: string; adminToken: string };

// Imágenes mínimas: solo importan los primeros bytes, que es lo que se valida.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const b64 = (data: Buffer) => data.toString("base64");

beforeAll(async () => {
  ctx = await setupIdentity();
  school = await ctx.createSchool("colegio-logo");
});
afterAll(() => ctx.close());

const upload = (token: string, image: string, url = "/school/logo") =>
  ctx.app.inject({ method: "PUT", url, headers: ctx.auth(token), payload: { image } });

describe("logo del colegio", () => {
  it("el administrador sube el logo y cualquier usuario del colegio lo ve", async () => {
    const res = await upload(school.adminToken, `data:image/png;base64,${b64(PNG)}`);
    expect(res.statusCode).toBe(200);
    expect((res.json() as SchoolDto).logoVersion).toBeTypeOf("number");

    await ctx.app.inject({
      method: "POST",
      url: "/users",
      headers: ctx.auth(school.adminToken),
      payload: { name: "Mamá", email: "mama@colegio-logo.hn", password: PASSWORD, role: "padre" },
    });
    const parent = await ctx.tokenFor("mama@colegio-logo.hn");
    const image = await ctx.app.inject({ url: "/school/logo", headers: ctx.auth(parent) });
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toBe("image/png");
    expect(image.rawPayload.equals(PNG)).toBe(true);

    const me = await ctx.app.inject({ url: "/me", headers: ctx.auth(parent) });
    expect(me.json().school.logoVersion).toBe((res.json() as SchoolDto).logoVersion);
  });

  it("el tipo se detecta por el contenido, no por lo que diga el archivo", async () => {
    const res = await upload(school.adminToken, `data:image/png;base64,${b64(JPEG)}`);
    expect(res.statusCode).toBe(200);
    const image = await ctx.app.inject({ url: "/school/logo", headers: ctx.auth(school.adminToken) });
    expect(image.headers["content-type"]).toBe("image/jpeg");
  });

  it.each([
    [
      "un SVG (puede llevar código)",
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    ],
    ["texto renombrado", Buffer.from("esto no es una imagen")],
  ])("rechaza %s", async (_name, data) => {
    const res = await upload(school.adminToken, b64(data));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain("PNG, JPG o WebP");
  });

  it("rechaza imágenes de más de 300 KB", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(301 * 1024)]);
    expect((await upload(school.adminToken, b64(big))).statusCode).toBe(400);
  });

  it("solo el administrador del colegio lo cambia; cada colegio ve solo el suyo", async () => {
    const parent = await ctx.tokenFor("mama@colegio-logo.hn");
    expect((await upload(parent, b64(PNG))).statusCode).toBe(403);

    const other = await ctx.createSchool("otro-colegio");
    const res = await ctx.app.inject({ url: "/school/logo", headers: ctx.auth(other.adminToken) });
    expect(res.statusCode).toBe(404);
  });

  it("el equipo de la plataforma puede cargarlo al dar de alta un colegio", async () => {
    const root = await ctx.tokenFor(SUPERADMIN.email, SUPERADMIN.password);
    const other = await ctx.createSchool("colegio-nuevo");
    const res = await upload(root, b64(PNG), `/schools/${other.schoolId}/logo`);
    expect(res.statusCode).toBe(200);
    expect((await upload(school.adminToken, b64(PNG), `/schools/${other.schoolId}/logo`)).statusCode).toBe(
      403,
    );
  });

  it("quitar el logo lo borra", async () => {
    const res = await ctx.app.inject({
      method: "DELETE",
      url: "/school/logo",
      headers: ctx.auth(school.adminToken),
    });
    expect(res.json().logoVersion).toBeNull();
    const image = await ctx.app.inject({ url: "/school/logo", headers: ctx.auth(school.adminToken) });
    expect(image.statusCode).toBe(404);
  });
});
