import http from "node:http";

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("ok");
});
server.listen(18092, "127.0.0.1", () => console.log("READY"));