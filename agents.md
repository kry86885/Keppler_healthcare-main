# HospAI Agent Operating Manual

This repository supports autonomous multi-agent execution for HospAI (Smart AI-enabled Hospital Management System).

## Objective
Build and finish HospAI end-to-end with production-grade quality, including:
- Full HMS modules (patient, billing, pharmacy, diagnostics, HRMS, analytics)
- Admin/normal access control with module-level permissions
- Mobile-first responsive UI for all screens
- Test coverage and deployment readiness

## Product Scope (Authoritative)
HospAI modules and requirements:
- Patient Management: registration, OP/IP, beds, meds scheduling, movement tracking, notes, visit timeline
- Dashboard: IP/OP counts, accidents, surgeries, revenue breakdown, dues, pharmacy/diagnostics summary, references
- Billing: OP/IP/Lab/Pharmacy integration, advance/refunds, payment gateway, collection reports
- Pharmacy: inventory, low stock alerts, expiry, damaged/proper stock, sales reports
- Lab/Diagnostics: vendors, doctor-wise tests, income, due/paid, invoice-wise reports
- HRMS: employees, attendance, payroll, leave, department mapping
- Security/Platform: web, cloud-ready, RBAC, audit logs, encryption, export PDF/Excel, responsive UI
- AI roadmap: predictive patient load, revenue forecast, medicine demand, critical alerts, billing anomaly detection

## Access Control Rules (Current)
- Two user types only: `admin`, `normal`
- Employee management is admin-only
- Admin assigns module-level access to normal users
- Permissions must be server-enforced and mirrored in frontend navigation/UI

## Team Topology
- Main Agent (Orchestrator): planning, sequencing, acceptance validation, integration
- Worker Agents:
  - Backend Worker
  - Frontend Worker
  - QA Worker
  - Docs/Release Worker

## Working Protocol
1. Main agent pulls next highest-priority backlog item.
2. Main agent creates clear worker tasks with acceptance criteria.
3. Workers implement in small PR-like chunks and return handoff notes.
4. QA worker validates behavior + regression tests.
5. Main agent merges results and updates backlog.
6. Repeat until all milestones are complete.

## Definition of Done (Global)
A task is done only when all are true:
- Behavior implemented and reviewed
- Tests added/updated and passing
- No permission/security regressions
- Mobile responsive behavior verified (small/medium/large breakpoints)
- Docs and changelog notes updated

## Hard Constraints
- Never bypass backend authorization with frontend-only checks.
- Default-deny module access for normal users when uncertain.
- Preserve backward compatibility for existing DB rows during migrations.
- Avoid destructive git/database operations unless explicitly requested.
