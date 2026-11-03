# Help desk feature parity

Checklist of the Freshdesk screens reviewed, and where each stands in SupportDesk.
Freshdesk was only viewed. No customer data was copied.

**Status:** Done = works end to end. Bridge = works, but needs an outside provider connected. Not built = missing.

## Tickets

| Freshdesk | SupportDesk | Status |
| --- | --- | --- |
| Personal, shared and default views, view search | `/tickets` | Done |
| Raised by me, mentioned in, watching, archive, spam, trash | `/tickets` | Done |
| Card and table layouts, inline status and priority | `/tickets` | Done |
| Filter panel with date ranges and product | `/tickets` | Done |
| Full CSV export of the current view | `/tickets` | Done |
| Bulk update and bulk scenarios | `/tickets` | Done |
| Reply, note, forward, attachments, canned responses | Ticket page | Done |
| @mentions in notes | Ticket page | Done |
| Insert solution article | Ticket page | Done |
| Merge and split | Ticket page | Done |
| Parent and child tickets, linked tickets | Ticket sidebar | Done |
| To-dos, time logs, requester's recent tickets | Ticket sidebar | Done |
| Threads (agents only) | Ticket sidebar | Done |
| Execute scenario, edit details, print, spam, delete | Ticket toolbar | Done |
| Convert to forum topic | Ticket toolbar | Done |
| Keyboard shortcuts, previous and next ticket | Ticket page | Done |
| Agent collision ("is viewing") | Ticket page | Done |
| Rich text composer | Plain text only | Not built |
| Device info | | Not built |

## Other areas

| Freshdesk | SupportDesk | Status |
| --- | --- | --- |
| My Dashboard: tiles, today's trends, filters | `/dashboard` | Done |
| Contacts and companies: import, export, custom fields | `/contacts`, `/companies` | Done |
| Knowledge base | `/solutions` | Done (already existed) |
| Forums with moderation, votes and portal community | `/forums`, `/portal/community` | Done |
| Curated reports | `/reports` | Done (already existed) |
| Custom reports: save, share, favourite, schedule by email | `/reports/custom` | Done (email needs SMTP) |
| Arcade leaderboard | `/arcade` | Done |
| Feedback form | `/feedback` | Done |

## Admin

| Freshdesk | SupportDesk | Status |
| --- | --- | --- |
| Agents, groups, business hours, SLA, tags, canned responses | Admin | Done (already existed) |
| Roles with enforced privileges | Admin, Roles | Done |
| Agent statuses | Admin, top bar | Done |
| Ticket fields: decimal and dependent types | Admin, Ticket fields | Done |
| Custom ticket statuses with customer labels | Admin, Ticket statuses | Done |
| Ticket forms | Admin, Ticket forms | Done |
| Automations with webhook and email actions | Admin, Automations | Done |
| Scenarios | Admin, Scenarios | Done |
| Ticket templates, including parent and child | Admin, Ticket templates | Done |
| Contact and company fields | Admin | Done |
| Multiple products | Admin, Products | Done |
| CSAT surveys with custom scales | Admin, Surveys | Done |
| Email notifications and email log | Admin | Done (needs SMTP to send) |
| Security settings and audit log | Admin, Security | Done |
| Account exports | Admin, Account exports | Done |
| Email mailboxes | Admin, Email & channels | Bridge: outgoing needs SMTP, incoming needs a mail gateway |
| WhatsApp, Facebook, phone, chat | Inbound webhook | Bridge: needs each provider's account |
| Separate portals per product | One portal with routing forms | Not built |
| Canned forms, session replay, custom objects | | Not built |
| Proactive outreach, Omniroute | Round-robin assignment only | Not built |
| Freddy AI | | Not built: needs an AI provider decision |
| Freshservice, Freshsales, marketplace apps | Webhook action only | Not built: Freshworks products |
| Plans and billing | | Not needed for a self-hosted app |

## Setup

Apply new tables without touching existing data:

```bash
npm --prefix backend run db:migrate
```

Add sample data for the new features:

```bash
node backend/src/db/seed-parity.js
```

To send real email, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` in `backend/.env`. Until then, messages are saved to the email log and marked "Logged".

To receive tickets from other channels, create a token under Admin, Email & channels, and have the provider POST to the listed URLs with an `x-inbound-token` header.
