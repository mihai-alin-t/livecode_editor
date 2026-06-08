# TODO — Learning Platform Pivot

Full design: docs/brainstorms/2026-06-08-learning-platform-brainstorm.md

---

## Auth
- [ ] Email + password registration and login
- [ ] Session management (httpOnly cookie or JWT)
- [ ] Protected routes (redirect to login if not authenticated)

## Database
- [ ] Choose DB (SQLite for local dev, Postgres for prod)
- [ ] Schema: users, challenges, submissions, scores
- [ ] Migration system

## Daily Challenge
- [ ] Cron job: call Claude at midnight to generate challenge for the day
- [ ] Challenge stored in DB (all users on the same day see the same challenge)
- [ ] Challenge delivered to user in chat on room join
- [ ] Topic/difficulty configuration (hardcoded rotation to start)

## Agentic Chat
- [ ] Claude integration (Anthropic SDK)
- [ ] Hint mode: user asks a question in chat → Claude responds with hints (no solution spoilers)
- [ ] Agent has read access to the current buffer when answering
- [ ] Rate limiting per user to prevent abuse

## Submission Flow
- [ ] "Submit" button in the editor header
- [ ] On submit: send full buffer to server
- [ ] Server calls Claude for structured code review (correctness, style, improvements)
- [ ] Review posted back into chat as a formatted agent message
- [ ] Quality score (0–100) extracted from review and saved to DB

## Leaderboard
- [ ] Per-challenge leaderboard: rank by combined score
- [ ] Combined score = quality score + time bonus (bonus decays over 30 min)
- [ ] Co-op scoring decision: shared score vs individual (TBD)
- [ ] Leaderboard page / panel in UI

## Open Questions
- [ ] Co-op scoring: one shared score for the room, or per-member?
- [ ] Should the agent see the full buffer or only what's quoted in chat?
- [ ] Admin panel for challenge topics/difficulty, or hardcoded rotation?
