# Privacy and retention

Local development stores synthetic account details, password hashes, hashed session and invitation credentials, a binary eligibility result and its local provider stamp, participant and timing records, blocks and reports. The submitted birth date is discarded. Expired email tokens and login sessions are cleared periodically.

Public age verification uses a hosted Veriff session. Trust Meet passes an opaque account identifier, reads the confirmed birth date in memory to check the 18+ threshold, and stores only the eligibility result, provider and timestamp. A temporary session identifier and resume URL are deleted after a final result or local expiry. Veriff's retention and document processing must be reviewed for the intended launch markets.

LiveKit carries conversation data. Session recording is disabled and the app keeps live text in browser memory. Reports contain the selected category and relationship to a session. Conversation metadata and reports remain until the local database is reset. Production retention, access auditing, legal holds and data deletion workflows are pending.
