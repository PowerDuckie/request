import http from "node:http";
import { WebSocketServer } from "ws";

// node examples/local-server.mjs &
// BASE_URL=http://127.0.0.1:4000/v1 node examples/demo.mjs

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname.startsWith("/v1/users/")) {
    const id = url.pathname.split("/").pop();
    res.writeHead(200, {
      "content-type": "application/json",
      "x-ratelimit-remaining": "99",
    });
    res.end(
      JSON.stringify({
        id,
        name: `User ${id}`,
        email: `user${id}@example.com`,
        tags: ["a", "b"],
      }),
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/orders") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      res.writeHead(201, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          orderId: "ord_1",
          echo: safeParse(body),
          createdAt: new Date().toISOString(),
        }),
      );
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    let index = 0;
    const words = ["Hello", " from", " the", " streaming", " endpoint", "."];
    const timer = setInterval(() => {
      if (index >= words.length) {
        res.write("data: [DONE]\n\n");
        clearInterval(timer);
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
    }, 200);
    req.on("close", () => clearInterval(timer));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

const wss = new WebSocketServer({ server, path: "/v1/realtime/general" });
wss.on("connection", (socket) => {
  let counter = 0;
  socket.send(JSON.stringify({ type: "welcome", room: "general" }));
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
      socket.close(1000, "done");
    }
  }, 400);
  socket.on("message", (data) => {
    socket.send(
      JSON.stringify({ type: "ack", received: data.toString().slice(0, 100) }),
    );
  });
  socket.on("close", () => clearInterval(timer));
});

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

server.listen(4000, () => console.log("demo server on http://127.0.0.1:4000"));
