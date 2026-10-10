# Smartwatch Companion Pattern

Use this pattern when an existing device app should gain a personal Agent. The app continues
to own the device connection; its backend sends approved data to API Claws.

## Resource mapping

| Product concept | API Claws resource |
| --- | --- |
| Developer account | One shared Developer Space |
| App user | One Agent |
| User memory and activity | That Agent's Drive |
| Conversation | Session below that Agent |
| Weekly plan adaptation | Scheduled task below that Agent |

This is an optional Agent-per-user mapping. The application owns authentication and the durable
`userId -> agentId` mapping. Multiple Sessions may belong to the same user's Agent; a Session
is not the user identity. Authorize every request before selecting a user's Agent.

```text
watch <-> app: existing product integration
app server -> API Claws: Agent integration
```

The app server writes the user's approved goal, activity, and feedback to that Agent's Drive.
A conversation or scheduled review can then use those records to suggest the next training plan.
API Claws does not pair, read, or control the watch directly.

## Bundled HTML preview

Open [demo.html](../assets/smartwatch-companion/demo.html) directly in a browser for an English
training workspace with sample workout sync, feedback, and an adjusted plan. Copy its entire
folder, including `assets/`, when using it in a project. Keep the API key on the server when
connecting the surface to your backend.

The page uses illustrative local data. Its user switch demonstrates separate sample UI state,
not real tenant isolation. It does not execute API calls, Agent runs, or scheduled tasks.

The optional `?render=1` view exposes `window.setSceneTime(milliseconds)` for a deterministic
13.667-second animation. The install command is real; the prompt and build sequence illustrate
the workflow rather than recording a coding agent generating an app. Verify a live integration
with the checks in the skill before presenting it as working.
