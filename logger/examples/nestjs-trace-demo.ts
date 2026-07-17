/**
 * NestJS version of the Express demo: orders → inventory, one shared
 * `trace_id`, boundary logging via LoggingInterceptor, and redaction.
 *
 * Run: npm run demo:nest
 */
import "reflect-metadata";
import {
  Controller,
  Get,
  Inject,
  Module,
  Param,
  type MiddlewareConsumer,
} from "@nestjs/common";
import { NestFactory, APP_INTERCEPTOR } from "@nestjs/core";
import {
  LoggerModule,
  LoggingInterceptor,
  TraceContextMiddleware,
  HOPAE_LOGGER,
} from "../src/nestjs/index";
import { outboundTraceHeaders } from "../src/http/index";
import type { Logger } from "../src/types";

const PORT_A = 4001;
const PORT_B = 4002;

// Service B: Inventory
@Controller()
class InventoryController {
  constructor(@Inject(HOPAE_LOGGER) private readonly logger: Logger) {}

  @Get("inventory/:sku")
  check(@Param("sku") sku: string) {
    this.logger.info("checking inventory", { sku });
    return { sku, inStock: true };
  }
}

@Module({
  imports: [
    LoggerModule.forRoot({
      service: "service-b",
      env: "demo",
      version: "1.0.0",
    }),
  ],
  controllers: [InventoryController],
  providers: [{ provide: APP_INTERCEPTOR, useExisting: LoggingInterceptor }],
})
class InventoryModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TraceContextMiddleware).forRoutes("*");
  }
}

// Service A: Orders (calls Service B)
@Controller()
class OrderController {
  constructor(@Inject(HOPAE_LOGGER) private readonly logger: Logger) {}

  @Get("order/:sku")
  async place(@Param("sku") sku: string) {
    // `authorization` is intentionally logged to demonstrate redaction.
    this.logger.info("order received", {
      sku,
      authorization: "Bearer super-secret-token",
    });

    const downstream = await fetch(
      `http://localhost:${PORT_B}/inventory/${sku}`,
      {
        headers: outboundTraceHeaders(),
      },
    );
    const data = await downstream.json();

    this.logger.info("inventory confirmed, placing order", {
      downstreamStatus: downstream.status,
      data,
    });
    return { ok: true, data };
  }
}

@Module({
  imports: [
    LoggerModule.forRoot({
      service: "service-a",
      env: "demo",
      version: "1.0.0",
    }),
  ],
  controllers: [OrderController],
  providers: [{ provide: APP_INTERCEPTOR, useExisting: LoggingInterceptor }],
})
class OrderModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TraceContextMiddleware).forRoutes("*");
  }
}

async function main() {
  // `logger: false` silences Nest's startup banner so the demo output is just
  // our structured JSON. The LoggingInterceptor still logs request boundaries.
  const appB = await NestFactory.create(InventoryModule, { logger: false });
  await appB.listen(PORT_B);

  const appA = await NestFactory.create(OrderModule, { logger: false });
  await appA.listen(PORT_A);

  console.log("\n--- firing one request to service-a /order/ABC-123 ---\n");
  const res = await fetch(`http://localhost:${PORT_A}/order/ABC-123`);
  await res.json();

  await appA.close();
  await appB.close();
}

void main();
