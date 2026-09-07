import { wsManualSession } from "../../dist/index.js";

const session = wsManualSession({
  url: process.env.WS_URL ?? "ws://124.222.6.60:8800",

  onEvent(event) {
    if (event.direction === "in") {
      console.log("收到消息:", {
        type: event.messageType,
        data: event.data,
        parsed: event.parsed,
      });
    }
  },
});

// 1. 手动连接
await session.open();
console.log("连接状态:", session.state);

// 2. 手动发送 Text
await session.send("Hello WebSocket", {
  type: "text",
});

// 3. 手动发送 JSON
await session.send(
  {
    type: "hello",
    message: "manual-json",
  },
  {
    type: "json",
  },
);

// 4. 手动发送 XML
await session.send(
  "<message><type>hello</type><text>manual-xml</text></message>",
  {
    type: "xml",
  },
);

// 5. 手动发送 HTML
await session.send("<strong>Hello WebSocket</strong>", {
  type: "html",
});

// 6. 手动发送 Binary
await session.send(Buffer.from([0x01, 0x02, 0x03]), {
  type: "binary",
});

// 等待接收服务端消息
await new Promise((resolve) => setTimeout(resolve, 1000));

// 7. 手动关闭
await session.close({
  code: 1000,
  reason: "manual demo completed",
});

await session.waitForClose();

console.log(JSON.stringify(session.events, null, 2));
