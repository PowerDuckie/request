// gRPC echo fixture server covering all four RPC modes.
//
// Supported:
// - Unary RPC
// - Server Streaming RPC
// - Client Streaming RPC
// - Bidirectional Streaming RPC
// - gRPC Server Reflection
//
// Discovery clients can dynamically discover:
// - Services
// - Methods
// - Messages
// - Enums
// - Proto file descriptors
//
// via:
// - grpc.reflection.v1alpha.ServerReflection
//
// Compatible with:
// - grpcurl
// - Postman
// - Custom gRPC discovery implementations

import path from "node:path";
import { fileURLToPath } from "node:url";

import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import { ReflectionService } from "@grpc/reflection";

/* -------------------------------------------------------------------------- */
/* Paths                                                                      */
/* -------------------------------------------------------------------------- */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const protoDir = path.join(__dirname, "proto");
const protoPath = path.join(protoDir, "echo", "echo.proto");

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

function assert(value, message) {
  if (!value) {
    throw new Error(message);
  }
}

/* -------------------------------------------------------------------------- */
/* Proto loader options                                                       */
/* -------------------------------------------------------------------------- */

const PROTO_LOADER_OPTIONS = {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [protoDir],
};

/* -------------------------------------------------------------------------- */
/* Load proto                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Keep the original PackageDefinition.
 *
 * This is important because:
 *
 * - grpc.loadPackageDefinition(packageDefinition)
 *   creates the runtime service objects.
 *
 * - new ReflectionService(packageDefinition)
 *   uses the original descriptor metadata.
 */
const packageDefinition = protoLoader.loadSync(
  protoPath,
  PROTO_LOADER_OPTIONS,
);

assert(
  packageDefinition,
  `Failed to load proto definition: ${protoPath}`,
);

const pkg = grpc.loadPackageDefinition(packageDefinition);

assert(
  pkg && typeof pkg === "object",
  "Failed to create gRPC package definition",
);

/* -------------------------------------------------------------------------- */
/* Resolve Echo service                                                       */
/* -------------------------------------------------------------------------- */

const echoPackage = pkg.echo;

assert(
  echoPackage,
  'Failed to resolve gRPC package "echo"',
);

const EchoService = echoPackage.Echo;

assert(
  EchoService,
  'Failed to resolve gRPC service "echo.Echo"',
);

assert(
  EchoService.service,
  'Service definition missing for "echo.Echo"',
);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function normalizeText(value) {
  return typeof value === "string" ? value : "";
}

function normalizeCount(value, fallback = 3, min = 1, max = 100) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const integer = Math.floor(value);

  return Math.max(min, Math.min(integer, max));
}

function createResponse(text, index) {
  return {
    text: normalizeText(text),
    index,
    serverAt: Date.now(),
  };
}

function createGrpcError(code, message) {
  const error = new Error(message);

  error.code = code;

  return error;
}

/* -------------------------------------------------------------------------- */
/* Server                                                                     */
/* -------------------------------------------------------------------------- */

const server = new grpc.Server();

/* -------------------------------------------------------------------------- */
/* Unary RPC                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * rpc UnaryEcho(EchoRequest) returns (EchoResponse)
 */
function UnaryEcho(call, callback) {
  try {
    const request = call.request ?? {};

    const response = createResponse(
      request.text,
      0,
    );

    callback(null, response);
  } catch (error) {
    callback(
      createGrpcError(
        grpc.status.INTERNAL,
        error instanceof Error
          ? error.message
          : "UnaryEcho failed",
      ),
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Server Streaming RPC                                                       */
/* -------------------------------------------------------------------------- */

/**
 * rpc ServerStreamEcho(EchoRequest)
 *   returns (stream EchoResponse)
 */
function ServerStreamEcho(call) {
  let finished = false;

  const finish = () => {
    if (finished) {
      return;
    }

    finished = true;

    if (!call.cancelled) {
      call.end();
    }
  };

  try {
    const request = call.request ?? {};

    const text = normalizeText(request.text);

    const count = normalizeCount(
      request.count,
      3,
      1,
      100,
    );

    for (let index = 1; index <= count; index += 1) {
      if (call.cancelled || finished) {
        break;
      }

      call.write(
        createResponse(text, index),
      );
    }

    finish();
  } catch (error) {
    finished = true;

    call.destroy(
      createGrpcError(
        grpc.status.INTERNAL,
        error instanceof Error
          ? error.message
          : "ServerStreamEcho failed",
      ),
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Client Streaming RPC                                                       */
/* -------------------------------------------------------------------------- */

/**
 * rpc ClientStreamEcho(stream EchoRequest)
 *   returns (EchoResponse)
 */
function ClientStreamEcho(call, callback) {
  const texts = [];

  let completed = false;

  function finish(error) {
    if (completed) {
      return;
    }

    completed = true;

    if (error) {
      callback(error);
      return;
    }

    callback(
      null,
      createResponse(
        texts.join("|"),
        texts.length,
      ),
    );
  }

  call.on("data", (request) => {
    if (completed) {
      return;
    }

    try {
      texts.push(
        normalizeText(request?.text),
      );
    } catch (error) {
      finish(
        createGrpcError(
          grpc.status.INTERNAL,
          error instanceof Error
            ? error.message
            : "Failed to process client stream message",
        ),
      );
    }
  });

  call.once("end", () => {
    finish();
  });

  call.once("error", (error) => {
    finish(
      createGrpcError(
        grpc.status.INTERNAL,
        error?.message || "Client stream failed",
      ),
    );
  });

  call.once("cancelled", () => {
    finish(
      createGrpcError(
        grpc.status.CANCELLED,
        "Client cancelled the request",
      ),
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Bidirectional Streaming RPC                                                */
/* -------------------------------------------------------------------------- */

/**
 * rpc BidiStreamEcho(stream EchoRequest)
 *   returns (stream EchoResponse)
 */
function BidiStreamEcho(call) {
  let closed = false;

  function close() {
    if (closed) {
      return;
    }

    closed = true;

    if (!call.cancelled) {
      call.end();
    }
  }

  function fail(error) {
    if (closed) {
      return;
    }

    closed = true;

    call.destroy(
      createGrpcError(
        grpc.status.INTERNAL,
        error instanceof Error
          ? error.message
          : "BidiStreamEcho failed",
      ),
    );
  }

  call.on("data", (request) => {
    if (closed || call.cancelled) {
      return;
    }

    try {
      const text = normalizeText(
        request?.text,
      );

      const index = normalizeCount(
        request?.count,
        0,
        0,
        Number.MAX_SAFE_INTEGER,
      );

      call.write(
        createResponse(text, index),
      );
    } catch (error) {
      fail(error);
    }
  });

  call.once("end", () => {
    close();
  });

  call.once("error", () => {
    closed = true;
  });

  call.once("cancelled", () => {
    closed = true;
  });
}

/* -------------------------------------------------------------------------- */
/* Register Echo service                                                      */
/* -------------------------------------------------------------------------- */

server.addService(
  EchoService.service,
  {
    UnaryEcho,
    ServerStreamEcho,
    ClientStreamEcho,
    BidiStreamEcho,
  },
);

/* -------------------------------------------------------------------------- */
/* gRPC Reflection                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Register gRPC Server Reflection.
 *
 * Exposes:
 *
 * grpc.reflection.v1alpha.ServerReflection
 *
 * Supported reflection operations include:
 *
 * - ListServices
 * - FileByFilename
 * - FileContainingSymbol
 * - FileContainingExtension
 * - AllExtensionNumbersOfType
 */
const reflectionService = new ReflectionService(
  packageDefinition,
);

reflectionService.addToServer(server);

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4500;

function resolvePort(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return DEFAULT_PORT;
  }

  const port = Number(value);

  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error(
      `Invalid PORT: ${String(value)}. Expected an integer between 1 and 65535.`,
    );
  }

  return port;
}

function resolveHost(value) {
  if (
    typeof value !== "string" ||
    value.trim() === ""
  ) {
    return DEFAULT_HOST;
  }

  return value.trim();
}

const host = resolveHost(
  process.env.HOST,
);

const port = resolvePort(
  process.env.PORT,
);

const address = `${host}:${port}`;

/* -------------------------------------------------------------------------- */
/* Graceful shutdown                                                          */
/* -------------------------------------------------------------------------- */

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(
    `Received ${signal}, shutting down gRPC server...`,
  );

  server.tryShutdown((error) => {
    if (error) {
      console.error(
        "Graceful shutdown failed:",
        error,
      );

      server.forceShutdown();
    }

    console.log(
      "gRPC server stopped",
    );

    process.exit(error ? 1 : 0);
  });
}

process.once(
  "SIGINT",
  () => shutdown("SIGINT"),
);

process.once(
  "SIGTERM",
  () => shutdown("SIGTERM"),
);

/* -------------------------------------------------------------------------- */
/* Start server                                                               */
/* -------------------------------------------------------------------------- */

server.bindAsync(
  address,
  grpc.ServerCredentials.createInsecure(),
  (error, boundPort) => {
    if (error) {
      console.error(
        `Failed to bind gRPC server on ${address}:`,
        error,
      );

      process.exit(1);
      return;
    }

    console.log(
      `gRPC server listening on ${host}:${boundPort}`,
    );

    console.log(
      "gRPC reflection enabled:",
    );

    console.log(
      "  grpc.reflection.v1alpha.ServerReflection",
    );

    console.log(
      "Available services:",
    );

    console.log(
      "  echo.Echo",
    );

    console.log(
      "  grpc.reflection.v1alpha.ServerReflection",
    );
  },
);