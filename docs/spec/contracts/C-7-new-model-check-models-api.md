# C-7 New-model check to the models API

**Producer:** Anthropic's models API. **Consumer:** `slicekit bench check` (06 REQ-6.8).

| Operation | Input | Output |
|---|---|---|
| List models | `GET /v1/models`, with the key from `ANTHROPIC_API_KEY` | the model IDs Anthropic lists |
| Find new models | that list and the report's rows | each listed model with no row in the report |
| Name a model by hand | a model ID a person gives, when no key is set | that model, treated as new |

A failed call SHALL stop the check with the API's status and message, and run no trial. The key
SHALL be read from the environment and written nowhere (06 REQ-6.9).

Cites: D-112, D-117, D-120.
