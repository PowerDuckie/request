// gRPC echo fixture server covering all four RPC modes.
// Discovery may run over reflection (grpc.reflection.v1alpha.ServerReflection)
// or plain proto loading, so both paths stay exercisable.
import path from "node:path";
import { fileURLToPath } from "node:url";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const protoDir = path.join(__dirname, "proto");
const protoPath = path.join(protoDir, "echo", "echo.proto");

const pkg = grpc.loadPackageDefinition(
  protoLoader.loadSync(protoPath, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [protoDir],
  }),
);

const service = pkg.echo.Echo.service;
const server = new grpc.Server();
server.addService(service, {
  UnaryEcho(call, callback) {
    const reply = {
      text: call.request.text,
      index: 0,
      server_at: Date.now(),
    };
    callback(null, reply);
  },

  ServerStreamEcho(call) {
    const count = Math.max(1, call.request.count || 3);
    for (let i = 1; i <= count; i += 1) {
      call.write({
        text: call.request.text,
        index: i,
        server_at: Date.now(),
      });
    }
    call.end();
  },

  ClientStreamEcho(call, callback) {
    const texts = [];
    call.on("data", (req) => texts.push(req.text));
    call.on("end", () => {
      callback(null, {
        text: texts.join("|"),
        index: texts.length,
        server_at: Date.now(),
      });
    });
  },

  BidiStreamEcho(call) {
    call.on("data", (req) => {
      call.write({
        text: req.text,
        index: req.count ?? 0,
        server_at: Date.now(),
      });
    });
    call.on("end", () => call.end());
  },
});

const port = Number(process.env.PORT ?? 4500);
const host = "127.0.0.1";
server.bindAsync(`${host}:${port}`, grpc.ServerCredentials.createInsecure(), (error, boundPort) => {
  if (error) {
    console.error("bind failed:", error);
    process.exit(1);
  }
  server.start();
  console.log(`grpc server listening on ${host}:${boundPort}`);
});
