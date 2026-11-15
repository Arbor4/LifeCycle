package demo;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;

public class App {
    public static void main(String[] args) throws Exception {
        long t0 = System.currentTimeMillis();
        System.out.println("[boot] binding 127.0.0.1:18091 ...");
        HttpServer server = HttpServer.create(new InetSocketAddress(18091), 0);
        server.createContext("/", ex -> {
            byte[] body = "ok".getBytes();
            ex.sendResponseHeaders(200, body.length);
            ex.getResponseBody().write(body);
            ex.close();
            System.out.println("[http] " + ex.getRequestMethod() + " " + ex.getRequestURI() + " -> 200");
        });
        server.start();
        System.out.println("[boot] http server started, workers=" + server.getExecutor());
        System.out.println("READY (started in " + (System.currentTimeMillis() - t0) + " ms)");
        Thread.currentThread().join();
    }
}