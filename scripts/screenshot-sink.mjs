import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const outputDir = path.join(process.cwd(), "qa-artifacts");
await fs.mkdir(outputDir, { recursive: true });
const server = http.createServer(async (request, response) => {
  const match = /^\/([a-z0-9-]+\.png)$/.exec(request.url ?? "");
  if (request.method !== "PUT" || !match) {
    response.writeHead(404).end();
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const data = Buffer.concat(chunks);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (data.length < signature.length || !data.subarray(0, 8).equals(signature)) {
    response.writeHead(415).end("PNG required");
    return;
  }
  const file = path.join(outputDir, match[1]);
  await fs.writeFile(file, data, { flag: "wx" });
  response.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({ file }));
});
server.listen(54330, "127.0.0.1", () => console.log("Local screenshot sink ready on 127.0.0.1:54330"));
