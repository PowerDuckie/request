import fs from "node:fs/promises";
import {
  createDebugger,
  discoverAndWriteGrpcOperations,
  grpcManualSession,
} from "../../dist/index.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const endpoint = {
  address: process.env.ADDRESS ?? "127.0.0.1:50051",
  protoPaths: [join(here, "proto")],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function print(title, value) {
  console.log(`\n== ${title} ==`);
  console.log(JSON.stringify(value, null, 2));
}

async function waitForEvent(session, predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const event = session.events.find(predicate);
    if (event) return event;
    await sleep(10);
  }

  throw new Error(`Timed out waiting for session event after ${timeoutMs}ms`);
}

async function runAutomaticScenarios(spec) {
  const debuggerClient = createDebugger({
    writeBack: {
      strategy: "merge",
      requirePassingTests: false,
    },
    response: {
      includeExamples: true,
    },
  });

  const scenarios = [
    {
      title: "unary",
      operationId: "grpc_demo_echo_Echo_Say",
      body: {
        messages: [
          {
            text: "hello",
            plain: "p",
          },
        ],
      },
    },
    {
      title: "server_streaming",
      operationId: "grpc_demo_echo_Echo_Countdown",
      body: {
        messages: [
          {
            from: 3,
            interval_ms: 10,
          },
        ],
        maxMessages: 10,
        maxStreamMs: 3_000,
      },
    },
    {
      title: "client_streaming",
      operationId: "grpc_demo_echo_Echo_Sum",
      body: {
        messages: [{ value: 1 }, { value: 2 }, { value: 3 }],
      },
    },
    {
      title: "bidi_streaming",
      operationId: "grpc_demo_echo_Echo_Chat",
      body: {
        messages: [{ text: "one" }, { text: "two" }],
        maxMessages: 10,
        maxSessionMs: 300,
      },
    },
  ];

  for (const scenario of scenarios) {
    const result = await debuggerClient.send({
      spec,
      target: {
        operationId: scenario.operationId,
      },
      values: {
        body: scenario.body,
      },
    });

    print(scenario.title, result.response.body);

    if (result.patchedSpec) {
      spec = result.patchedSpec;
    }
  }

  return spec;
}

async function runManualBidiStreaming() {
  const session = await grpcManualSession({
    ...endpoint,
    service: "demo.echo.Echo",
    method: "Chat",
  });

  try {
    await session.open();

    console.log("manual bidi state after open:", session.state);

    await session.send({ text: "manual-1" });
    await session.send({ text: "manual-2" });

    await waitForEvent(
      session,
      (event) =>
        event.direction === "inbound" &&
        event.payload?.text === "you said: manual-2",
    );

    // 对 bidi 流执行客户端半关闭。
    await session.close();
    await session.waitForClose();

    print("manual_bidi_streaming", {
      state: session.state,
      warnings: session.warnings,
      events: session.events,
    });

    if (session.state !== "closed") {
      throw new Error(
        `Manual bidi session did not close correctly: ${session.state}`,
      );
    }
  } finally {
    if (session.state !== "closed") {
      await session.close().catch(() => {});
    }
  }
}

async function runManualClientStreaming() {
  const session = await grpcManualSession({
    ...endpoint,
    service: "demo.echo.Echo",
    method: "Sum",
  });

  try {
    await session.open();

    console.log("manual client stream state after open:", session.state);

    await session.send({ value: 1 });
    await session.send({ value: 2 });
    await session.send({ value: 3 });

    // client-streaming 的 close() 表示发送结束，
    // 服务端随后返回单个最终响应。
    await session.close();
    await session.waitForClose();

    const response = session.events.find(
      (event) =>
        event.direction === "inbound" &&
        event.payload?.total === 6 &&
        event.payload?.count === 3,
    );

    if (!response) {
      throw new Error(
        "Manual client-streaming response { total: 6, count: 3 } was not received",
      );
    }

    print("manual_client_streaming", {
      state: session.state,
      warnings: session.warnings,
      events: session.events,
    });

    if (session.state !== "closed") {
      throw new Error(
        `Manual client-streaming session did not close correctly: ${session.state}`,
      );
    }
  } finally {
    if (session.state !== "closed") {
      await session.close().catch(() => {});
    }
  }
}

async function main() {
  let spec = {
    openapi: "3.2.0",
    info: {
      title: "gRPC OpenAPI Demo",
      version: "1.0.0",
    },
    paths: {},
  };

  const discovered = await discoverAndWriteGrpcOperations(spec, endpoint);
  spec = discovered.spec;

  print(
    "discovered_operations",
    discovered.discovery.services.flatMap((service) =>
      service.methods.map((method) => ({
        service: service.name,
        method: method.name,
        kind: method.kind,
      })),
    ),
  );

  await fs.writeFile(
    new URL("./openapi.generated.json", import.meta.url),
    JSON.stringify(spec, null, 2),
  );

  spec = await runAutomaticScenarios(spec);

  await runManualBidiStreaming();
  await runManualClientStreaming();

  await fs.writeFile(
    new URL("./openapi.patched.json", import.meta.url),
    JSON.stringify(spec, null, 2),
  );

  console.log("\nAll gRPC demo scenarios passed.");
}

main().catch((error) => {
  console.error("\ngRPC demo failed:");
  console.error(error);
  process.exitCode = 1;
});
