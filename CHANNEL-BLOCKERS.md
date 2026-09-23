# Payment channels on pay #464 — what blocks a payment

Tested 2026-09-18 against `feat/pay-cloud` @ `36f10c5`, Fedora 44, Ledger Stax.
Single-payment schemes (MPP charge, x402 `exact`, x402 `upto`) work. Every
"deposit once, spend many times" scheme does not.

## Blockers

1. **Ledger never enumerates** — `solana-remote-wallet 4.2.2` rejects the
   seven-field app-configuration vector of Solana app >= 1.16. Fix is
   agave#15100, open since 05.09, unreleased. Workaround: vendor the crate with
   `config.len() < 5`. Without it nothing below is reachable at all.

2. **MPP session — the CLI opens a channel it cannot use. Root cause found.**
   `cli/src/commands/mod.rs:1892` drops the session handle (`let (_handle,
   auth_header) = open_payment_channel_session_header(...)`) and retries once
   with the opening header. `voucher_header` — which the client module
   documents as "client-signed channels send voucher_header(cost) per request"
   — is never called anywhere in the repo. The server only accepts a bearer
   proof for operator-signed sessions (`verify_use_authentication`), so a
   client-signed channel waits for a voucher that never arrives and answers
   402. Confirmed locally: gate logs `Open Confirmed → Escrow Confirmed →
   Client Confirmed`, client gets `402 again after payment`. Not one usable
   request, let alone many.

3. **Same symptom is invisible on the hosted sandbox.** `GET /api/v1/stream` on
   `402.surfnet.dev` returns 0 bytes in 20 s with no gate log entry, instead of
   the 402 the local gate returns. Reproduced with a software wallet and with a
   minimal 36-line paywall, so it is not the playground spec. One local run also
   failed earlier at `InstructionError(0, Custom(58))` in preflight (signature
   never on chain); it did not recur and is unexplained.

4. **Hosted sandbox silently drops operator transactions.** x402 `upto` returned
   `{"status":"ok"}` while its settlement never landed
   (`getSignatureStatuses` → `null`), RPC healthy, slots advancing. Local
   surfpool reports the same class of failure with a reason — hosted does not.

5. **x402 batch-settlement never reuses its channel.** `BatchChannelCache::new()`
   is constructed inside the handling of one 402
   (`cli/src/commands/mod.rs:1775`), so each request gets an empty cache. Three
   MCP calls in one process = three full `402 → ~12 s → 200` cycles. The funding
   transaction is never amortised, which is the whole point of the scheme.

6. **Hardware wallets are excluded from vouchers by design.** Batch-settlement
   vouchers, operator-signed session proofs, subscription proofs and x402
   sign-in all go through `require_raw_message_signing`; the Solana app signs an
   off-chain envelope, not raw bytes. Client-signed MPP sessions are the one
   channel scheme a Ledger could drive — and that is the one blocked by (2)/(3).

## Secondary

- `pay mcp` ignores `--account` in both positions; only `PAY_ACTIVE_ACCOUNT` works.
- `pay --local mcp` funds the wallet on the hosted sandbox while serving local requests.
- `discover()` retries ~22× on `Protocol("Version packet")`, an error its own log calls unrecoverable.
- Error text points at `just rust-ledger-diagnose`, a target that exists only in solana-keychain.
- `AccountsFile::load().unwrap_or_default()` (`cli/src/main.rs:176`) turns a malformed config into "account not found".

## Options for MPP sessions

### Fixed locally 2026-09-18 (not upstreamed)

~20 lines in `cli/src/commands/mod.rs`: keep the session handle, and when the
server answers the `open` action with another payment-required response, build
`voucher_header(request.amount)` and retry. `GET /v1/tick` now returns
`{"status":"ok"}` instead of 402 — the first metered request served over a
channel in this setup.

Second finding from the same fix: the response after `open` is **not**
classified as a session challenge. The runner reports `UnknownPaymentRequired`,
so matching on `RunOutcome::SessionChallenge` alone silently does nothing —
the match has to include `UnknownPaymentRequired`.

Also seen once, retryable, unrelated: `open openSlot N is ahead of the current
cluster slot N-1` — the challenge's slot races the validator by one slot.

Remaining work:

| | cost | yields |
|---|---|---|
| Keep the handle and send `voucher_header(cost)` on each retry in the CLI | ~half a day | the first genuinely usable client-signed session |
| Rewrite `push_session_full_flow` against a real validator (it mocks RPC today) | ~half a day | a regression test that would have caught this |
| Ask the PR author whether any client drives sessions end-to-end (JS playground?) | 0 | may show the gap is CLI-only |
