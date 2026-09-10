# API Claws endpoint reference

Base URL `https://buda.im/api/v1`. Every endpoint takes `Authorization: Bearer <key>`, where the
key is your `sk_` API key — except the `/embed/...` endpoints, which take a short-lived embed
token instead. Live spec: `https://buda.im/api/v1/openapi.json`.

Endpoints are grouped by the harness job they do, not alphabetically, so you can find the one
you need from "what am I trying to build".

## Check that the key works

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/health` | `{ status, timestamp }` — no auth needed |
| GET | `/meta` | `{ service, version, timestamp }` |
| GET | `/users/me` | The account the key belongs to. First call to make. |

## Tenancy — Spaces

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/spaces` | `{ spaces[], total }`. List before creating, or retries duplicate tenants. |
| POST | `/spaces` | Body `{ name, slug?, logo? }` → the Space. `201`. |

## Agents

Two equivalent surfaces exist. `api-agents` is the flat developer-facing one; the Space-scoped
routes are there for provisioning systems that already carry both IDs.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api-agents` | `{ apiAgents[], total }` across all your Spaces |
| POST | `/api-agents` | Body `{ spaceId, name, emoji?, instructions?, storageType? }` → agent. `201` |
| PATCH | `/api-agents/{agentId}` | Body: any of `{ name, emoji, instructions }` |
| GET | `/spaces/{spaceId}/agents` | Same agents, scoped to one Space |
| POST | `/spaces/{spaceId}/agents` | Same as `POST /api-agents` with `spaceId` in the path |

An agent response carries `{ id, spaceId, nodeId, driveId, name, emoji, status, modelId, createdAt, updatedAt }`.
`status` is `idle | working | waiting_for_input | alert | disabled`.

## Memory — Drive

The agent's durable file store. Text writes go through `files`; binaries go through the
upload-url → confirm-upload pair.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api-agents/{agentId}/drive/files` | Query `path?`. → `{ files[], total }` |
| PUT | `/api-agents/{agentId}/drive/files` | Body `{ path, content, mimeType? }`. Creates or overwrites. |
| GET | `/api-agents/{agentId}/drive/items` | Files and folders with storage keys |
| POST | `/api-agents/{agentId}/drive/text` | Body `{ filePath, maxBytes? }` → `{ content, exists, isText, tooLarge, sizeBytes, updatedAt }` |
| POST | `/api-agents/{agentId}/drive/upload-url` | Body `{ fileName, mimeType, sizeBytes, parentPath? }` → presigned target |
| POST | `/api-agents/{agentId}/drive/confirm-upload` | Body `{ fileName, storageKey, parentPath?, uploadSessionId? }` |
| GET | `/api-agents/{agentId}/drive/uploads/{uploadSessionId}` | Upload status |
| DELETE | `/api-agents/{agentId}/drive/uploads/{uploadSessionId}` | Abort an upload |
| POST | `/api-agents/{agentId}/drive/download-url` | Body `{ storageKey, filename?, expiresIn?, asAttachment? }` |
| POST | `/api-agents/{agentId}/drive/rename` | Body `{ oldStorageKey, newName, isFolder? }` |
| POST | `/api-agents/{agentId}/drive/delete` | Body `{ storageKey, name, isFolder?, size? }` |
| GET | `/spaces/{spaceId}/agents/{agentId}/drive/files` | Space-scoped equivalent |
| PUT | `/spaces/{spaceId}/agents/{agentId}/drive/files` | Space-scoped equivalent |

## Conversation — Sessions

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api-agents/{agentId}/sessions` | Body `{ message, title?, mode?, model?, startRun?, attachments? }`. `202` → `{ session, run }` |
| GET | `/api-agents/{agentId}/sessions` | Query `limit? offset? status?` |
| GET | `/api-agents/{agentId}/sessions/{sessionId}` | → `{ session, messages[], run: { status, streamUrl, cancelUrl } }` |
| POST | `/api-agents/{agentId}/sessions/{sessionId}/messages` | Continue the conversation. `202` |
| PATCH | `/api-agents/{agentId}/sessions/{sessionId}` | Rename |
| DELETE | `/api-agents/{agentId}/sessions/{sessionId}` | Delete |
| DELETE | `/api-agents/{agentId}/sessions/{sessionId}/run` | Cancel the active run → `{ ok, cancelled }` |
| POST | `/api-agents/{agentId}/sessions/{sessionId}/attachments` | Body `{ fileName, mimeType, sizeBytes }` → presigned upload |
| POST | `/spaces/{spaceId}/agents/{agentId}/chat-sessions` | Space-scoped create-or-continue (`sessionId?` in body) |

Session status: `pending | in_progress | waiting_for_input | completed | failed | cancelled`.
Settled = the last four. `mode`: `agent | chat | thinking | build-app`.

## Frontend-safe access — Embed

Your backend mints; the frontend consumes. The frontend never sees the `sk_` key.

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/spaces/{spaceId}/agents/{agentId}/embed-urls` | `sk_` | → `{ embedUrl, sessionId, agentId, spaceId, expiresAt, api }`. Iframe `embedUrl` verbatim. |
| POST | `/spaces/{spaceId}/agents/{agentId}/embed-sessions` | `sk_` | Same plus `token`, for your own UI |
| POST | `/embed/chat-sessions/{sessionId}/messages` | embed token | Body `{ message, mode?, startRun? }` → `{ sessionId, queued, run }` |
| GET | `/embed/chat-sessions/{sessionId}` | embed token | → `{ session, messages[] }` |

Mint body: `{ externalUserId, displayName?, sessionId?, ttlSeconds?, mode?, metadata? }`.
`ttlSeconds` is 60–86400. Pass an existing `sessionId` to keep the same conversation across
token refreshes.

## Unattended work — Scheduled tasks

Use these instead of running your own cron that calls the API — the schedule lives with the agent.

| Method | Path | Notes |
| --- | --- | --- |
| GET / POST | `/api-agents/{agentId}/scheduled-tasks` | Create body `{ name, taskTemplate, scheduleType: cron\|interval\|once, cronExpression?, intervalMinutes?, scheduledAt?, maxRuns?, timezone?, isEnabled }` |
| GET | `/api-agents/{agentId}/scheduled-tasks/limits` | Plan limits: max count, min interval, whether cron is allowed |
| POST | `/api-agents/{agentId}/scheduled-tasks/validate-cron` | Validate before creating |
| GET / PATCH / DELETE | `/api-agents/{agentId}/scheduled-tasks/{taskId}` | Read, update, remove |
| POST | `/api-agents/{agentId}/scheduled-tasks/{taskId}/enable` \| `/disable` \| `/run` | Toggle or fire now |
| GET | `/api-agents/{agentId}/scheduled-tasks/{taskId}/runs` | Run history |

Check `/limits` before creating: plans differ in how many tasks are allowed, the minimum
interval, and whether cron expressions are permitted at all.

## External surfaces — Channels

Bind an agent to a messaging platform so users reach it where they already are.

| Method | Path | Notes |
| --- | --- | --- |
| GET / POST | `/api-agents/{agentId}/channels` | List or connect a channel |
| PATCH / DELETE | `/api-agents/{agentId}/channels/{channelId}` | Update or disconnect |
| POST | `/api-agents/{agentId}/channels/connections` | Start a managed connection flow |
| POST | `/api-agents/{agentId}/channels/connections/{connectionId}/poll` | Poll that flow to completion |

## Errors

`400` bad request · `401` bad/expired key · `403` key valid but not allowed on this resource ·
`404` wrong ID or wrong Space · `500`/`502` on channel-connection routes.

Bodies are `{ "error": "..." }`. A `403` where you expected `404` usually means the agent exists
but belongs to a Space your key does not own — check your provisioning records, not the endpoint.
