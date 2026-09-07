
import { loadGrpc } from "./loader.js";
import { buildCredentialsChecked } from "./credentials.js";
import { resolveMethod } from "./descriptor.js";
import { buildCatalog } from "./catalog.js";
import type { GrpcSendOptions, GrpcTarget } from "./types.js";

export async function createGrpcManualSession(target: GrpcTarget, options: GrpcSendOptions = {}) {
  const { grpc } = await loadGrpc();
  const { credentials, warnings } = buildCredentialsChecked(grpc, { tls: target.tls });
  const { catalog, packageDefinition } = await buildCatalog(target);
  const method = await resolveMethod(target, { catalog, packageDefinition });
  const md = new grpc.Metadata();
  for (const [k,v] of Object.entries(target.metadata ?? {})) for (const item of (Array.isArray(v)?v:[v])) md.add(k, item);
  const clientCtor = (grpc.loadPackageDefinition(packageDefinition) as any);
  const serviceParts = target.service.split(".");
  let svc:any = clientCtor;
  for (const p of serviceParts) svc = svc?.[p];
  const client = new svc(target.address, credentials, target.channelOptions ?? {});
  const events:any[] = [];
  let state:"connecting"|"open"|"closing"|"closed"="connecting";
  let call:any;
  if (method.kind === "unary" || method.kind === "server_streaming") {
    throw new Error("manual session is only meaningful for client_streaming or bidi_streaming");
  }
  call = client[method.name](md);
  state = "open";
  call.on("data",(msg:any)=>events.push({direction:"inbound",payload:msg,at:Date.now()}));
  call.on("end",()=>{state="closed";});
  call.on("error",()=>{state="closed";});
  return {
    warnings,
    get state(){ return state; },
    get events(){ return events; },
    async open(){},
    async send(message: unknown){ call.write(message); events.push({direction:"outbound",payload:message,at:Date.now()}); },
    async close(){ state="closing"; call.end(); },
    async waitForClose(){ if(state==="closed") return; await new Promise(r=>call.on("end",r)); },
  };
}
