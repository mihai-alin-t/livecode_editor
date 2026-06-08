---
date: 2026-06-08
topic: learning-platform-pivot
---

# Pivot: Live Code Editor → Collaborative Learning Platform

## What We're Building

Transform the existing real-time collaborative editor into a coding learning platform. Users receive a daily AI-generated coding challenge, work on it solo or in a co-op room with a teammate, get hints from an AI agent while coding, and receive a quality review when they submit. A leaderboard ranks all participants by a combined time + quality score.

## Why This Approach

The existing shared-buffer + rooms model is kept as-is — a **room is a session**. Solo and co-op are not separate modes; they are the same thing with one or two people in the room. No architectural split is needed. The collaborative editor becomes the co-op primitive for free.

## Key Decisions

- **Room = session**: solo users work alone in a room; co-op users share a room URL. Same code path.
- **AI-generated challenges**: Claude generates a new challenge each day given a topic and difficulty level. Stored in DB so all users on the same day get the same challenge.
- **Agentic chat**: Claude participates in the room chat — gives hints on demand while coding, and delivers a structured code review when the user submits.
- **Combined score**: `score = quality_score (0–100) + time_bonus`. Time bonus decays as solve time increases (e.g. full bonus under 5 min, zero after 30 min).
- **Auth**: Standard email + password with sessions. No OAuth for now.

## New Components Needed

| Component | Description |
|---|---|
| Auth system | Registration, login, session management |
| Database | Users, challenges, submissions, scores |
| Challenge generator | Cron job: Claude generates daily challenge at midnight |
| Agent (hints) | Claude responds in chat when users ask for help |
| Agent (evaluator) | Claude reviews submitted code, returns structured feedback + score |
| Submission flow | "Submit" button → evaluation → score saved → leaderboard updated |
| Leaderboard | Per-challenge ranking by combined score |

## What Stays From Current Build

- WebSocket server + rooms
- Shared buffer + collaborative editing (OT, op queue)
- Chat panel + typing indicators
- Presence bar
- Language selector
- Reset / undo

## Open Questions

- What database? SQLite is simplest for a learning project; Postgres for production.
- How are challenge topics/difficulty configured? Hardcoded rotation vs admin panel?
- Co-op scoring: does the team share one score or each member scores individually?
- Should the agent have access to the full buffer when giving hints, or only what the user pastes in chat?

## Next Steps

→ `/workflows:plan` for implementation details
