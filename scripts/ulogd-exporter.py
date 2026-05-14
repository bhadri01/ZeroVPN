#!/usr/bin/env python3
"""
ulogd2 JSON → worker ingest exporter.

Tails ulogd JSON output (from /dev/stdout piped to a named pipe or
docker logs) and sends flow events to the worker's destination_ingest
TCP endpoint at `INGEST_ENDPOINT` (default localhost:9898).
"""

import json
import os
import sys
import socket
from datetime import datetime

INGEST_ENDPOINT = os.getenv("INGEST_ENDPOINT", "localhost:9898")
BATCH_SIZE = 10


def transform_ulogd_to_flow(ulogd_obj):
    """
    Transform ulogd JSON dict to flow event format expected by
    zerovpn-worker destination_ingest.
    
    ulogd fields (sample):
        {
            "raw.pktlen": 60,
            "raw.pktcount": 1,
            "flow.start": 1715706545123,
            "ip.saddr": "10.0.0.5",
            "ip.daddr": "8.8.8.8",
            "ip.protocol": 6,
            "tcp.sport": 54321,
            "tcp.dport": 443,
            ...
        }
    """
    try:
        src_ip = ulogd_obj.get("ip.saddr")
        dst_ip = ulogd_obj.get("ip.daddr")
        proto_num = ulogd_obj.get("ip.protocol")
        src_port = ulogd_obj.get("tcp.sport") or ulogd_obj.get("udp.sport")
        dst_port = ulogd_obj.get("tcp.dport") or ulogd_obj.get("udp.dport")
        bytes_in = ulogd_obj.get("raw.pktlen", 0)
        bytes_out = 0  # ulogd doesn't track direction easily; approximation
        started_at = None
        
        # started_at from flow.start (milliseconds since epoch)
        if "flow.start" in ulogd_obj:
            ts_ms = ulogd_obj["flow.start"]
            if isinstance(ts_ms, (int, float)):
                started_at = datetime.utcfromtimestamp(ts_ms / 1000.0).isoformat() + "Z"
        
        if not src_ip or not dst_ip:
            return None
        
        proto = "tcp" if proto_num == 6 else "udp" if proto_num == 17 else None
        
        return {
            "src_ip": src_ip,
            "src_port": src_port,
            "dst_ip": dst_ip,
            "dst_port": dst_port,
            "proto": proto,
            "bytes_in": int(bytes_in),
            "bytes_out": int(bytes_out),
            "started_at": started_at,
        }
    except Exception as e:
        print(f"transform error: {e}", file=sys.stderr)
        return None


def main():
    host, port = INGEST_ENDPOINT.split(":")
    port = int(port)
    
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.connect((host, port))
        print(f"connected to {host}:{port}", file=sys.stderr)
    except Exception as e:
        print(f"failed to connect: {e}", file=sys.stderr)
        sys.exit(1)
    
    buffer = []
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            
            try:
                obj = json.loads(line)
                flow = transform_ulogd_to_flow(obj)
                if flow:
                    buffer.append(flow)
                    if len(buffer) >= BATCH_SIZE:
                        for f in buffer:
                            try:
                                sock.sendall((json.dumps(f) + "\n").encode())
                            except Exception as e:
                                print(f"send error: {e}", file=sys.stderr)
                        buffer = []
            except json.JSONDecodeError:
                pass  # skip non-JSON lines
    finally:
        if buffer:
            for f in buffer:
                try:
                    sock.sendall((json.dumps(f) + "\n").encode())
                except Exception as e:
                    print(f"send error: {e}", file=sys.stderr)
        sock.close()


if __name__ == "__main__":
    main()
