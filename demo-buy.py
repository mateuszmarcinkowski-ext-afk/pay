#!/usr/bin/env python3
"""Buy several different documents over one `pay mcp` connection.

Unlike demo-session.py, which hammers one URL, this walks a list of distinct
paths at distinct prices — the point being that a single channel, opened once,
funds all of them.

Usage:  demo-buy.py <path> [<path> ...]      paths are relative to DEMO_BASE
Env:    DEMO_BASE (default http://127.0.0.1:1408)
        DEMO_ACCOUNT (default payer)
"""

import json
import os
import subprocess
import sys
import time

BASE = os.environ.get("DEMO_BASE", "http://127.0.0.1:1408").rstrip("/")
ROOT = os.path.expanduser("~/projects/pay-464")
BIN = os.path.join(ROOT, "rust/target/debug/pay")
paths = sys.argv[1:] or ["/v1/spot/btc"]

env = dict(os.environ)
env.update({
    "HOME": os.path.join(ROOT, ".home"),
    "PAY_ACTIVE_ACCOUNT": os.environ.get("DEMO_ACCOUNT", "payer"),
    "PAY_NETWORK_ENFORCED": "localnet",
    "PAY_RPC_URL": "http://127.0.0.1:8899",
    "RUST_LOG": os.environ.get("RUST_LOG", "error"),
})

proc = subprocess.Popen([BIN, "mcp"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                        env=env, text=True, bufsize=1)


def send(obj):
    proc.stdin.write(json.dumps(obj) + "\n")
    proc.stdin.flush()


def pump(expect_id):
    while True:
        line = proc.stdout.readline()
        if not line:
            sys.exit("pay mcp closed the connection")
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if msg.get("method") == "elicitation/create":
            send({"jsonrpc": "2.0", "id": msg["id"],
                  "result": {"action": "accept", "content": {"approved": True}}})
            continue
        if msg.get("id") == expect_id and ("result" in msg or "error" in msg):
            return msg


send({"jsonrpc": "2.0", "id": 1, "method": "initialize",
      "params": {"protocolVersion": "2025-06-18",
                 "capabilities": {"elicitation": {}},
                 "clientInfo": {"name": "pay-buy-demo", "version": "0"}}})
pump(1)
send({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})

failed = False
for i, path in enumerate(paths, start=1):
    url = BASE + "/" + path.lstrip("/")
    started = time.time()
    send({"jsonrpc": "2.0", "id": 100 + i, "method": "tools/call",
          "params": {"name": "curl", "arguments": {"url": url}}})
    msg = pump(100 + i)
    elapsed = time.time() - started
    if "error" in msg:
        print(f"{elapsed:6.1f}s  FAILED {path}: {msg['error']}", flush=True)
        failed = True
        continue
    body = " ".join(c.get("text", "").strip()
                    for c in msg["result"].get("content", []) if c.get("type") == "text")
    flag = " (isError)" if msg["result"].get("isError") else ""
    print(f"{elapsed:6.1f}s{flag}  {path}\n         {body[:220]}", flush=True)

proc.stdin.close()
proc.terminate()
proc.wait(timeout=10)
sys.exit(1 if failed else 0)
