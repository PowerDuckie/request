
import WebSocket from "ws";

export function runWebSocketSession(config: {
  url: string;
  headers?: Record<string,string>;
  subprotocols?: string[];
  closeCode?: number;
  closeReason?: string;
  rejectUnauthorized?: boolean;
}) {
  const events:any[] = [];
  let state:"connecting"|"open"|"closing"|"closed"="connecting";
  let ws: WebSocket;
  let closedResolve!: ()=>void;
  const closed = new Promise<void>(r=>closedResolve=r);
  return {
    get events(){ return events; },
    get state(){ return state; },
    async open() {
      if (ws) return;
      ws = new WebSocket(config.url, config.subprotocols ?? [], { headers: config.headers, rejectUnauthorized: config.rejectUnauthorized !== false });
      await new Promise<void>((resolve,reject)=>{
        ws.once("open",()=>{ state="open"; resolve(); });
        ws.once("error",reject);
      });
      ws.on("message",(data,isBinary)=>events.push({direction:"in", receivedAt:Date.now(), event:isBinary?"binary":"text", data:isBinary?Buffer.from(data as any).toString("base64"):String(data)}));
      ws.on("close",()=>{ state="closed"; closedResolve(); });
    },
    async send(message: unknown, options?: { delayMs?: number }) {
      if (options?.delayMs) await new Promise(r=>setTimeout(r, options.delayMs));
      const data = typeof message === "string" ? message : JSON.stringify(message);
      ws.send(data);
      events.push({direction:"out", receivedAt:Date.now(), event:"text", data});
    },
    async close(options?: { code?: number; reason?: string }) {
      if (!ws || state === "closed") return;
      state = "closing";
      ws.close(options?.code ?? config.closeCode ?? 1000, options?.reason ?? config.closeReason ?? "manual close");
    },
    waitForClose() { return closed; }
  };
}
