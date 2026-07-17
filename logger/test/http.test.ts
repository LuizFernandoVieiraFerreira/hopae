import { describe, it, expect } from "vitest";
import {
  traceContextMiddleware,
  outboundTraceHeaders,
} from "../src/http/index";
import { getContext, type TraceContext } from "../src/context";
import { parseTraceparent, formatTraceparent } from "../src/trace";

const HEX32 = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;

function fakeReq(headers: Record<string, string | string[] | undefined> = {}) {
  return { headers };
}

function fakeRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  };
}

/** Runs the middleware and captures the context that is active inside `next`. */
function runMiddleware(
  req: ReturnType<typeof fakeReq>,
  res: ReturnType<typeof fakeRes>,
  options?: Parameters<typeof traceContextMiddleware>[0],
): TraceContext | undefined {
  const mw = traceContextMiddleware(options);
  let captured: TraceContext | undefined;
  mw(req, res, () => {
    captured = getContext();
  });
  return captured;
}

describe("traceContextMiddleware", () => {
  it("generates a fresh trace + span when there is no inbound traceparent", () => {
    const ctx = runMiddleware(fakeReq(), fakeRes());

    expect(ctx?.traceId).toMatch(HEX32);
    expect(ctx?.spanId).toMatch(HEX16);
    expect(ctx?.parentSpanId).toBeUndefined();
  });

  it("reuses the inbound trace id, mints a new span, and records the parent span", () => {
    const inboundTrace = "4bf92f3577b34da6a3ce929d0e0e4736";
    const inboundSpan = "00f067aa0ba902b7";
    const ctx = runMiddleware(
      fakeReq({ traceparent: formatTraceparent(inboundTrace, inboundSpan) }),
      fakeRes(),
    );

    expect(ctx?.traceId).toBe(inboundTrace); // same trace continues
    expect(ctx?.spanId).toMatch(HEX16);
    expect(ctx?.spanId).not.toBe(inboundSpan); // this hop gets its own span
    expect(ctx?.parentSpanId).toBe(inboundSpan);
  });

  it("generates a fresh trace when the inbound header is malformed", () => {
    const ctx = runMiddleware(
      fakeReq({ traceparent: "not-a-valid-header" }),
      fakeRes(),
    );

    expect(ctx?.traceId).toMatch(HEX32);
    expect(ctx?.parentSpanId).toBeUndefined();
  });

  it("echoes the trace context back on the response headers by default", () => {
    const res = fakeRes();
    const ctx = runMiddleware(fakeReq(), res);

    expect(res.headers.traceparent).toBe(
      formatTraceparent(ctx!.traceId, ctx!.spanId),
    );
    expect(res.headers["x-trace-id"]).toBe(ctx!.traceId);
  });

  it("does not set response headers when disabled", () => {
    const res = fakeRes();
    runMiddleware(fakeReq(), res, { setResponseHeaders: false });

    expect(Object.keys(res.headers)).toHaveLength(0);
  });

  it("supports a custom inbound header name", () => {
    const inboundTrace = "4bf92f3577b34da6a3ce929d0e0e4736";
    const ctx = runMiddleware(
      fakeReq({
        "x-cloud-trace": formatTraceparent(inboundTrace, "00f067aa0ba902b7"),
      }),
      fakeRes(),
      { header: "x-cloud-trace" },
    );

    expect(ctx?.traceId).toBe(inboundTrace);
  });

  it("does not leak context outside the request", () => {
    runMiddleware(fakeReq(), fakeRes());
    expect(getContext()).toBeUndefined();
  });
});

describe("outboundTraceHeaders", () => {
  it("returns a traceparent for the active context", () => {
    const mw = traceContextMiddleware();
    let headers: Record<string, string> = {};
    mw(fakeReq(), fakeRes(), () => {
      headers = outboundTraceHeaders();
    });

    const parsed = parseTraceparent(headers.traceparent);
    expect(parsed).not.toBeNull();
    expect(parsed?.traceId).toMatch(HEX32);
  });

  it("returns nothing outside a request context", () => {
    expect(outboundTraceHeaders()).toEqual({});
  });

  it("propagates the same trace end-to-end across two service hops", () => {
    // Service A: fresh request (no inbound header).
    const aMw = traceContextMiddleware();
    let aCtx: TraceContext | undefined;
    let outbound: Record<string, string> = {};
    aMw(fakeReq(), fakeRes(), () => {
      aCtx = getContext();
      outbound = outboundTraceHeaders(); // headers A sends to B
    });

    // Service B: receives A's outbound headers.
    const bMw = traceContextMiddleware();
    let bCtx: TraceContext | undefined;
    bMw(fakeReq(outbound), fakeRes(), () => {
      bCtx = getContext();
    });

    expect(bCtx?.traceId).toBe(aCtx?.traceId); // one trace across both hops
    expect(bCtx?.spanId).not.toBe(aCtx?.spanId); // but distinct spans
    expect(bCtx?.parentSpanId).toBe(aCtx?.spanId); // B's parent is A's span
  });
});
