#!/usr/bin/env python3
"""Drive `pay mcp` over stdio: several metered requests on one connection.

One process means one channel. The Ledger approves the `open` transaction once;
every later request is paid with a voucher signed by the ephemeral session key
this process holds, so the device is not consulted again.

Env:
  DEMO_CALLS=3    how many requests to make
  DEMO_WAIT=1     wait for Enter before each request after the first
  DEMO_URL=...    override the metered endpoint
  DEMO_ACCOUNT=   pay account to use (default repro-464, the Ledger)
"""

import json
import os
import subprocess
import sys
import time

URL = os.environ.get("DEMO_URL", "http://127.0.0.1:1404/v1/tick")
CALLS = int(os.environ.get("DEMO_CALLS", "3"))
WAIT = os.environ.get("DEMO_WAIT") == "1"
ROOT = os.path.expanduser("~/projects/pay-464")
BIN = os.path.join(ROOT, "rust/target/debug/pay")

env = dict(os.environ)
env.update(
    {
        "HOME": os.path.join(ROOT, ".home"),
        "PAY_ACTIVE_ACCOUNT": os.environ.get("DEMO_ACCOUNT", "repro-464"),
        "PAY_NETWORK_ENFORCED": "localnet",
        "PAY_RPC_URL": "http://127.0.0.1:8899",
    }
)

proc = subprocess.Popen(
    [BIN, "mcp"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    env=env,
    text=True,
    bufsize=1,
)


def send(obj):
    proc.stdin.write(json.dumps(obj) + "\n")
    proc.stdin.flush()


def pump(expect_id):
    """Read until the response to expect_id, approving any elicitation."""
    while True:
        line = proc.stdout.readline()
        if not line:
            sys.exit("pay mcp closed the connection (see its log above)")
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            print(f"   [non-JSON on stdout] {line.rstrip()}", flush=True)
            continue
        if msg.get("method") == "elicitation/create":
            print("   [pay asked for approval -> approving]", flush=True)
            send(
                {
                    "jsonrpc": "2.0",
                    "id": msg["id"],
                    "result": {"action": "accept", "content": {"approved": True}},
                }
            )
            continue
        if msg.get("id") == expect_id and ("result" in msg or "error" in msg):
            return msg


send(
    {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {"elicitation": {}},
            "clientInfo": {"name": "pay-session-demo", "version": "0"},
        },
    }
)
pump(1)
send({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})

print(f"one `pay mcp` process, {CALLS} requests to {URL}\n", flush=True)
failed = False
for i in range(1, CALLS + 1):
    if WAIT and i > 1:
        input(f"-- Enter to send request {i}/{CALLS} (unplug the Ledger now) ")
    print(f"-- request {i}/{CALLS}", flush=True)
    started = time.time()
    send(
        {
            "jsonrpc": "2.0",
            "id": 100 + i,
            "method": "tools/call",
            "params": {"name": "curl", "arguments": {"url": URL}},
        }
    )
    msg = pump(100 + i)
    elapsed = time.time() - started
    if "error" in msg:
        print(f"   FAILED after {elapsed:.1f}s: {msg['error']}", flush=True)
        failed = True
        break
    body = " ".join(
        c.get("text", "").strip()
        for c in msg["result"].get("content", [])
        if c.get("type") == "text"
    )
    flag = " (isError)" if msg["result"].get("isError") else ""
    print(f"   {elapsed:5.1f}s{flag}  {body[:300]}", flush=True)

proc.stdin.close()
proc.terminate()
proc.wait(timeout=10)
sys.exit(1 if failed else 0)
