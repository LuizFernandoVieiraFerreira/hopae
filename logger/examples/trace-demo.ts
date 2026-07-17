/**
 * End-to-end demo: two services, one request, one trace id.
 *
 * service-a receives a request, logs, then calls service-b forwarding the
 * trace context. Both services emit structured JSON with the SAME `trace_id`,
 * proving cross-service correlation. It also shows sensitive fields being
 * redacted automatically.
 *
 * Run: npm run demo
 */
import express from "express";
import { createLogger } from "../src/index";
import {
  traceContextMiddleware,
  outboundTraceHeaders,
} from "../src/http/index";

const PORT_A = 4001;
const PORT_B = 4002;

const loggerA = createLogger({
  service: "service-a",
  env: "demo",
  version: "1.0.0",
});
const loggerB = createLogger({
  service: "service-b",
  env: "demo",
  version: "1.0.0",
});

// Service B: Inventory
const b = express();
b.use(traceContextMiddleware());
b.get("/inventory/:sku", (req, res) => {
  loggerB.info("checking inventory", { sku: req.params.sku });
  res.json({ sku: req.params.sku, inStock: true });
});

// Service A: Orders (calls Service B)
const a = express();
a.use(traceContextMiddleware());
a.get("/order/:sku", async (req, res) => {
  // NOTE: `authorization` is intentionally logged to demonstrate redaction.
  loggerA.info("order received", {
    sku: req.params.sku,
    authorization: "Bearer super-secret-token",
  });

  const downstream = await fetch(
    `http://localhost:${PORT_B}/inventory/${req.params.sku}`,
    {
      headers: outboundTraceHeaders(),
    },
  );
  const data = await downstream.json();

  loggerA.info("inventory confirmed, placing order", {
    downstreamStatus: downstream.status,
    data,
  });
  res.json({ ok: true, data });
});

const serverB = b.listen(PORT_B, () => {
  const serverA = a.listen(PORT_A, async () => {
    // eslint-disable-next-line no-console
    console.log("\n--- firing one request to service-a /order/ABC-123 ---\n");
    const res = await fetch(`http://localhost:${PORT_A}/order/ABC-123`);
    await res.json();
    setTimeout(() => {
      serverA.close();
      serverB.close();
    }, 150);
  });
});
