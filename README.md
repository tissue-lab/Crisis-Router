# Crisis Router

**An autonomous AI agent that triages emergencies and dispatches the right NGO — instantly.**

Built for: *Agentic for Humans* & *Buildathon* (AWS-powered hackathons)

## The Problem
When someone encounters an emergency — an injured animal, a blood shortage, a medical crisis, a disaster — they often don't know which NGO or responder can actually help. Manual routing wastes the minutes that matter most.

## The Solution
A person describes what's happening (text + optional photo). An autonomous AI agent:
1. Reads the report — text and image together
2. Searches an NGO database using its own tool-calling loop
3. Evaluates candidate NGOs against the actual situation
4. Classifies urgency — Critical or Standard
5. Dispatches automatically — WhatsApp for Critical, email for Standard

No human in the loop. No manual lookup. The agent makes the call.

## Why This Is Agentic
- The agent decides its own search keywords — not hardcoded
- It can search again with broader terms if results are weak
- It cross-checks NGO capabilities against the emergency before deciding
- It classifies urgency and writes the dispatch message itself

## Tech Stack
| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router), Tailwind CSS |
| Agent / LLM | Google Gemini, tool-calling via `@google/genai` |
| Database | Supabase (Postgres), fuzzy NGO search |
| Critical dispatch | Twilio WhatsApp |
| Standard dispatch | Resend (email) |
| Hosting | Render |

## Architecture

User submits report (text + photo + GPS + phone)
│
▼
Agent reads report ──► calls search_ngos tool ──► Supabase fuzzy search
│ │
│◄───────────────── candidate NGOs ──────────────┘
▼
Agent evaluates, picks best fit, classifies urgency, writes message
│
├── Critical ──► WhatsApp (Twilio)
└── Standard ──► Email (Resend)
│
▼
Result shown: NGO selected, rationale, dispatch status


## Live Demo
🔗 [crisis-router.onrender.com](https://crisis-router.onrender.com)

## Local Setup
See `README.md` for full setup instructions (Supabase, Gemini, Twilio, Resend, env vars).

## Roadmap
- Verified NGO onboarding beyond seed data
- Multi-NGO dispatch for large-scale incidents
- Production WhatsApp templates (custom-approved)
- NGO-facing dashboard
- Multilingual intake

## Team
Team Draciel, signing off

