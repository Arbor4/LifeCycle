use std::io::Write;
use std::net::TcpListener;

fn main() {
    let listener = TcpListener::bind("127.0.0.1:18093").expect("bind");
    println!("READY");
    for stream in listener.incoming() {
        if let Ok(mut s) = stream {
            let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
        }
    }
}