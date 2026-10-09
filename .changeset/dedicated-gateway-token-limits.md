---
"@aliou/pi-ts-aperture": patch
---

Dedicated mode: take the context window and output limit from the gateway when it reports them.

`/v1/models` reports `context_window_tokens` and `max_output_tokens` per entry (Aperture commit `f3e7fbd1`, after the metadata resolver landed here); the client dropped both on the floor, so every dedicated model resolved its limits from Pi's registry or models.dev. Where the catalogs do not know the model under the gateway's id shape, that silently produced the 128000/8192 safe defaults: `anthropic/claude-opus-5-5` registered as 128k instead of the gateway's 1M, and `xai/grok-4.5` as 128k/8192 instead of 500k/500k. The five models affected also came out non-reasoning, since reasoning resolves from the same metadata.

The gateway's numbers now win over catalog metadata, matching how gateway pricing already wins over catalog cost: they describe the endpoint Pi sends to, and a route can cap a model below its native capacity. An over-reported limit is a rejected request, while an under-reported one only compacts early. On the maintainer's catalog that moves 17 of 53 models, mostly by a few percent (Google's 1048576 vs the gateway's 1000000), and 14 output limits, including `deepseek/deepseek-v4.1-flash` from 943718 to 32768.

Catalogs still supply vision input, reasoning, thinking levels, and names, and the 128000/8192 defaults remain the last resort for a gateway that reports no limit.
