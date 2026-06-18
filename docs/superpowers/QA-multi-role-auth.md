# QA — Multi-Role Auth

## Admin (existing BOSS_SECRET TOTP)
- [ ] Login via "Personal" tab with the authenticator code → header shows "Admin".
- [ ] "Bosse" nav link is visible; can create a boss (name + departments) and see a QR.
- [ ] Scan the QR in an authenticator app; that code logs in as the boss (Step below).
- [ ] Can create/delete departments and create/edit/delete any member.
- [ ] Can approve any pending leave.

## Boss (own department[s] only)
- [ ] Login via "Personal" tab with the boss's authenticator code → header shows the boss name + "Boss".
- [ ] "Bosse" link is NOT visible.
- [ ] /mitglieder shows ONLY members in the boss's department(s); can create/edit/delete them.
- [ ] Cannot assign a member to a department the boss does not own (rejected).
- [ ] /abteilungen shows only owned departments; can rename them; cannot create or delete.
- [ ] /urlaube "Offene Genehmigungen" shows only own-department pending requests; can approve them.
- [ ] Attempting to approve another department's request (e.g. via crafted form) is rejected server-side.

## Member (email/password)
- [ ] Admin/boss created the member with an email + initial password.
- [ ] Login via "Mitglied" tab with email/password → header shows the member name + "Mitglied".
- [ ] /urlaube leave form is pre-bound to the member (no user picker); can file own request.
- [ ] Cannot see "Offene Genehmigungen"; cannot access member/department/boss management actions.
- [ ] Wrong password is rejected.

## Anonymous
- [ ] Can view the calendar/overview without logging in.
