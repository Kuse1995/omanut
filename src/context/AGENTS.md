# context

- Platform admins (`user_roles.admin`) get owner-level `currentRole` in `CompanyContext` for any company they open, mirrored in the database by `has_company_role` / `user_has_company_access_v2` returning true for admins. Add admin bypasses in those two places, never per page, so the UI and the server always agree.
