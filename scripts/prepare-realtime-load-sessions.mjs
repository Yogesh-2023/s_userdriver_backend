import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.LOAD_BASE_URL ?? "http://127.0.0.1:3000";
const outputPath = resolve(
  process.env.LOAD_SESSION_MANIFEST ?? "/tmp/fleet-realtime-load-sessions.json",
);
const roles = (process.env.LOAD_SESSION_ROLES ?? "CUSTOMER,DRIVER")
  .split(",")
  .map((role) => role.trim().toUpperCase())
  .filter((role) => role === "CUSTOMER" || role === "DRIVER");

if (!roles.length) {
  throw new Error("LOAD_SESSION_ROLES must include CUSTOMER and/or DRIVER.");
}

let sequence = 0;
const nextPhone = () => {
  sequence += 1;
  return `+9166${String(Date.now() + sequence).slice(-8)}`;
};

const credentials = [];
for (const role of roles) {
  const phone = nextPhone();
  const requested = await fetch(`${baseUrl}/api/v1/auth/otp/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, role }),
  });
  if (!requested.ok) {
    throw new Error(`OTP request for ${role} failed with ${requested.status}.`);
  }

  const verified = await fetch(`${baseUrl}/api/v1/auth/otp/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, role, otp: "1234" }),
  });
  if (!verified.ok) {
    throw new Error(`OTP verification for ${role} failed with ${verified.status}.`);
  }
  const setCookie = verified.headers.get("set-cookie");
  const cookie = setCookie?.split(";")[0];
  if (!cookie) throw new Error(`No session cookie was returned for ${role}.`);
  credentials.push({ role, cookie });
}

await writeFile(outputPath, `${JSON.stringify(credentials, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
process.stdout.write(
  `Created ${credentials.length} short-lived load sessions at ${outputPath}.\n`,
);
