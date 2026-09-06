import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";

export interface TestServer {
  port: number;
  baseUrl: string;
  requests: Array<{
    method: string;
    path: string;
    headers: http.IncomingHttpHeaders;
    body: string;
  }>;
  close(): Promise<void>;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
  });
}

export async function startTestServer(): Promise<TestServer> {
  const requests: TestServer["requests"] = [];
  const timers = new Set<NodeJS.Timeout>();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const body = await readBody(req);

    requests.push({
      method: req.method ?? "GET",
      path: `${url.pathname}${url.search}`,
      headers: req.headers,
      body,
    });

    if (req.method === "GET" && url.pathname === "/v1/users/boom") {
      res.writeHead(500, {
        "content-type": "application/json",
      });
      res.end(JSON.stringify({ error: "internal" }));
      return;
    }

    if (req.method === "GET" && /^\/v1\/users\/[^/]+$/.test(url.pathname)) {
      const id = url.pathname.split("/").pop() as string;
      const payload: Record<string, unknown> = {
        id,
        name: `User ${id}`,
        tags: ["a", "b"],
      };

      if (id !== "9") {
        payload.email = `user${id}@example.com`;
      }

      res.writeHead(200, {
        "content-type": "application/json",
        "x-ratelimit-remaining": "99",
      });
      res.end(JSON.stringify(payload));
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/orders") {
      res.writeHead(201, {
        "content-type": "application/json",
      });
      res.end(
        JSON.stringify({
          orderId: "ord_1",
          echo: safeParse(body),
          createdAt: new Date().toISOString(),
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      const words = ["Hello", " from", " the", " streaming", " endpoint", "."];
      let index = 0;

      const timer = setInterval(() => {
        if (index >= words.length) {
          res.write("data: [DONE]\n\n");
          clearInterval(timer);
          timers.delete(timer);
          res.end();
          return;
        }

        const payload = {
          id: `chunk_${index}`,
          choices: [{ delta: { content: words[index] }, index: 0 }],
        };

        res.write(
          `id: ${index}\nevent: chunk\ndata: ${JSON.stringify(payload)}\n\n`,
        );

        index += 1;
      }, 40);

      timers.add(timer);
      req.on("close", () => {
        clearInterval(timer);
        timers.delete(timer);
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/chat/endless") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      let n = 0;
      const timer = setInterval(() => {
        n += 1;
        res.write(`data: ${JSON.stringify({ seq: n })}\n\n`);
      }, 20);

      timers.add(timer);
      req.on("close", () => {
        clearInterval(timer);
        timers.delete(timer);
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/chat/truncated") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      res.write(`data: ${JSON.stringify({ seq: 1 })}\n\n`);
      res.write(`data: {"seq": 2`);

      const timer = setTimeout(() => {
        res.destroy();
        timers.delete(timer);
      }, 50);

      timers.add(timer);
      return;
    }

    res.writeHead(404, {
      "content-type": "application/json",
    });
    res.end(JSON.stringify({ error: "not found" }));
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (!url.pathname.startsWith("/v1/realtime/")) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (socket) => {
    let counter = 0;

    socket.send(JSON.stringify({ type: "welcome" }));

    const timer = setInterval(() => {
      counter += 1;
      socket.send(
        JSON.stringify({
          type: "message",
          seq: counter,
          text: `tick ${counter}`,
        }),
      );

      if (counter >= 10) {
        clearInterval(timer);
        timers.delete(timer);
        socket.close(1000, "done");
      }
    }, 30);

    timers.add(timer);

    socket.on("message", (data) => {
      socket.send(
        JSON.stringify({
          type: "ack",
          received: data.toString().slice(0, 100),
        }),
      );
    });

    socket.on("close", () => {
      clearInterval(timer);
      timers.delete(timer);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const { port } = server.address() as AddressInfo;

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    async close() {
      for (const timer of timers) {
        clearTimeout(timer);
        clearInterval(timer);
      }

      for (const client of wss.clients) {
        client.terminate();
      }

      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });

      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
