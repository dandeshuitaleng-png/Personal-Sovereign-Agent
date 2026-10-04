import { resolve } from "node:path";
import { createApp } from "./app.js";
const { app } = await createApp({
  dataDir: resolve(process.env.PSA_DATA_DIR || ".psa-data"),
  serveWeb: true,
});
await app.listen({ host: "127.0.0.1", port: 4318 });
console.log("Personal Sovereign Agent is available at http://127.0.0.1:4318");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => void app.close().then(() => process.exit(0)));
