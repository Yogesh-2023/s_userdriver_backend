import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { registerCors } from "../src/config/cors";

const adminOrigin = "https://tuk-admin.technogigz.co.in";

describe("CORS", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await registerCors(app);
    app.post("/api/v1/admin/auth/login", async () => ({ success: true }));
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("allows the production admin login preflight", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/admin/auth/login",
      headers: {
        origin: adminOrigin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-csrf-token",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(adminOrigin);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
    expect(response.headers["access-control-allow-methods"]).toContain(
      "OPTIONS",
    );
    expect(response.headers["access-control-allow-headers"]).toContain(
      "Content-Type",
    );
    expect(response.headers["access-control-allow-headers"]).toContain(
      "x-csrf-token",
    );
  });
});
