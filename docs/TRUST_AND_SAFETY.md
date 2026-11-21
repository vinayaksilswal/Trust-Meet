# Trust and safety

Conversations need an active account and an 18+ date-of-birth check. Calls start only after both people accept, and the camera and microphone stay off until then. Either participant can end a call, block the other person or send a categorized report. A block prevents any future match between the two accounts.

## Moderation console

Staff review reports at `/moderation`. The link appears in the sidebar only for staff accounts, and the API answers 404 to everyone else.

- **Queue:** open reports, with suspected minors, threats and sexual content first. Then come people reported by the most different users. Room reports show the room host as the subject.
- **Decisions:** *Dismiss* closes one report. *Suspend* signs the account out everywhere, ends its call, removes it from private rooms, and closes every open report about that person. The maintenance worker then revokes any media access the account still holds.
- **Accounts:** search by email or display name, see report counts, and suspend or reinstate accounts (for appeals).
- **Audit log:** every decision with the moderator, the account, the time and the note.

Staff accounts can't be suspended from the console, and moderators can't act on themselves.

## Granting access

Roles are granted only from the operator CLI, by someone with database access, never through the website:

```sh
python -m conviya.moderation_ops grant --email moderator@example.com --reviewer "your name"
python -m conviya.moderation_ops revoke --email moderator@example.com --reviewer "your name"
```

Sign-up doesn't verify email addresses. Before granting access, confirm the moderator is signed in to that exact account.

## Still open

- Nobody watches the queue around the clock yet. Staff it before public launch, especially for suspected-minor reports.
- There is no automatic nudity detection on video.
- Preserving evidence of child sexual abuse material and reporting it to Indian authorities (cybercrime.gov.in, 1930) is a manual process. Write it down as a procedure.
