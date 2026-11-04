# Wadhwani Support

A full-featured help desk (Freshdesk-style) built with **React**, **Node.js/Express** and **PostgreSQL**.

```
support-application/
├── backend/    Node.js + Express REST API, Postgres schema, seed data
└── frontend/   React (Vite) agent dashboard + customer portal
```

## Quick start

Prerequisites: Node 18+, PostgreSQL running locally (defaults: 127.0.0.1:5432, user `postgres`, password `1234`).

```bash
# 1. Backend – creates the `supportdesk` database, applies the schema, seeds demo data
cd backend
npm install
npm run db:reset
npm run dev          # API on http://localhost:4000

# 2. Frontend (in a second terminal)
cd frontend
npm install
npm run dev          # App on http://localhost:5173
```

Open http://localhost:5173 and sign in.

### Demo accounts (password: `password123`)

| Role                | Email                    |
| ------------------- | ------------------------ |
| Admin agent         | admin@supportdesk.local  |
| Agent               | priya@supportdesk.local  |
| Customer (portal)   | customer@acme.com        |

Database connection settings live in `backend/.env`. The app creates and uses its own `supportdesk` database on your Postgres server; the `postgres` maintenance database is only used to create it.

See [docs/FEATURE_PARITY.md](docs/FEATURE_PARITY.md) for the full feature checklist and what still needs an outside provider.

## Features

**Tickets**
- Inbox with views (unresolved, my open, unassigned, overdue, due today, watching, spam, trash), filters, sorting, search, pagination and CSV export
- Saved views (private or shared with all agents)
- Create on behalf of a contact (auto-creates contacts, links companies by email domain)
- Public replies, private notes, forwards, attachments, canned responses with placeholders, agent signature
- Status / priority / type / source / group / agent / tags / due date / custom fields
- Bulk actions (assign, status, priority, group, spam, delete, restore)
- Merge tickets, watch tickets, time tracking, full activity log
- Round-robin auto-assignment inside groups

**SLA**
- Multiple SLA policies with conditions (priority, type, source, group, company) and per-priority response/resolution targets
- Due dates computed on create and recalculated when priority changes; SLA clock paused while pending
- Breach detection every minute with notifications to assignee/group; escalation flags

**Automations**
- Rules on ticket created / ticket updated / time-based (every 10 min)
- Conditions on 18 fields with 12 operators; actions: set priority/status/type, assign group/agent, add/remove tags, add note, notify agent/group/assignee, escalate, mark spam

**People**
- Contacts (merge, block, portal access, tags), Companies (domains, tier, health, renewal), Agents & roles, Groups

**Knowledge base**
- Categories → folders (public / logged-in / agents-only) → articles (draft/published, tags, keywords, views, helpful votes)
- Public portal with search, popular articles, related articles, article feedback

**Customer portal**
- Self sign-up, submit tickets (with suggested articles while typing), attachments, reply, close/reopen, CSAT rating

**Reports**
- Overview (volume trend, status/priority/type/source, SLA compliance, CSAT, weekday/hour heat), agent performance, groups, companies, satisfaction, time tracking, CSV export

**Admin**
- General settings, agents, groups, SLA policies, automations, tags, business hours, custom ticket fields

**Other**
- JWT auth for agents and customers, role-based access (admin / agent / customer)
- In-app notifications (assignments, replies, SLA breaches, mentions, CSAT)
- Global search across tickets, contacts, companies and articles
- Auto-close resolved tickets after N days (configurable)

## API

All endpoints are under `/api` (see `backend/src/app.js`). The frontend dev server proxies `/api` and `/uploads` to the backend, so no CORS setup is needed in development.

Useful scripts in `backend/`:

| Script              | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `npm run db:setup`  | Create the database if it does not exist       |
| `npm run db:migrate`| Apply `src/db/schema.sql` (`--fresh` to wipe)  |
| `npm run db:seed`   | Load demo agents, contacts, tickets, KB, rules |
| `npm run db:reset`  | setup + fresh migrate + seed                   |
| `npm run dev`       | Start the API with auto-reload                 |

## Notes

- SLA targets are computed in calendar hours; business-hours schedules are stored and shown but not yet used to pause the SLA clock.
- Email sending is not wired up; replies and notifications are in-app. The data model (cc/to emails, sources) is ready for an email integration.
- Uploads are stored on disk in `backend/uploads/`.
