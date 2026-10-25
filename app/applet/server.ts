import fs from "node:fs";
import path from "node:path";

const isDev =
  process.env.NODE_ENV !== "production" &&
  !process.env.K_SERVICE &&
  (!process.env.PORT || process.env.PORT === "3000");

const distServer = path.resolve(process.cwd(), "dist/server.cjs");

if (!isDev && fs.existsSync(distServer)) {
  // Production runtime: Load compiled, bundled CommonJS server
  await import("./dist/server.cjs");
} else {
  // Development / test runtime: Load TypeScript server via tsx
  const { startServer } = await import("./src/server.ts");
  await startServer();
}
