
import { wsManualSession } from "../../dist/index.js";
const url = process.env.WS_URL ?? "ws://127.0.0.1:4300/v1/realtime/general";
const s = wsManualSession({ url, subprotocols: ["demo.v1"] });
await s.open();
await s.send({ type: "hello", text: "manual ws" });
await s.send({ type: "ping" });
await new Promise(r=>setTimeout(r, 500));
await s.close();
await s.waitForClose();
console.log(JSON.stringify(s.events, null, 2));
