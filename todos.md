# HospAI Access Control TODO

## Phase 1: Foundation
- [x] Add planning files (`todos.md`, `agents.md`)
- [x] Define final access model: `admin` and `normal`
- [x] Define module catalog for module-level grants

## Phase 2: Backend RBAC Migration
- [x] Add `user_type` and `module_access` columns to `users`
- [x] Backfill existing users into new model safely
- [x] Update auth login/session payloads to expose new fields
- [x] Replace permission resolution logic to use module grants
- [x] Keep backward compatibility with legacy `role/access_role`

## Phase 3: Employee Management APIs
- [x] Accept `user_type` and `module_access` on employee create
- [x] Support editing `user_type` and `module_access`
- [x] Restrict employee-management actions to admins

## Phase 4: Frontend RBAC
- [x] Update types/constants for new access model
- [x] Update employee add/edit forms for module assignment
- [x] Update nav permission behavior from new permission map

## Phase 5: Verification
- [x] Update backend auth/RBAC tests
- [x] Run backend tests and fix failures
- [x] Smoke-check frontend build/type checks
