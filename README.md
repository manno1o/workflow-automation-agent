# workflow-automation-agent

Work in progress. Inbound lead -> extracted lead -> quote from a price book -> approval gate ->
CRM deal + Stripe invoice + email.

Done so far: pipeline state machine, dedupe, retries with idempotency keys, approval gate for
quotes >= $500 and emergencies, Claude extractor (with a keyword fallback), HubSpot + Stripe
clients, HTTP API, tests.

Next: Gmail + Telegram, persistent store, Cloudflare Workers deploy, extraction evals.

```bash
npm install
npm test
npm start   # POST /inbound/email {id, from, subject, body}
```
