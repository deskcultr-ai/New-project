-- RBAC overhaul, step 1 of 2: rename the three existing role tiers and add a
-- brand-new fourth tier ("manager") between team_leader and executive.
--
-- Organization Super Admin (was Super Admin)
--         v
-- Team Leader (was Admin)
--         v
-- Manager (new)
--         v
-- Executive (was Employee)
--
-- Kept in its own migration/transaction on purpose: Postgres does not allow
-- a newly ADDed enum value to be referenced by any statement in the same
-- transaction that added it. Renaming existing values has no such
-- restriction, so this file only touches the enum + the one column that
-- names the old "super_admin" role -- every function/policy/trigger that
-- reads or writes these values is rewritten in the next migration, once
-- this one has committed.

alter type public.org_role rename value 'super_admin' to 'org_super_admin';
alter type public.org_role rename value 'admin' to 'team_leader';
alter type public.org_role rename value 'employee' to 'executive';
alter type public.org_role add value 'manager' after 'team_leader';

-- organizations.super_admin_id -> org_super_admin_id (its unique constraint
-- and index are renamed automatically along with the column).
alter table public.organizations rename column super_admin_id to org_super_admin_id;
