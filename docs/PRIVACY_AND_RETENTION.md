# Privacy and retention

Local development stores synthetic account details, password hashes, hashed session and invitation credentials, a binary eligibility result and its local provider stamp, participant and timing records, blocks and reports. The submitted birth date is discarded. Expired email tokens and login sessions are cleared periodically.

Users enter their date of birth. Trust Meet uses the submitted date in memory to check the 18+ threshold and stores the eligibility result and timestamp.

LiveKit or Cloudflare RealtimeKit carries conversation data. Session recording is disabled and the app keeps live text in browser memory. Reports contain the selected category and relationship to a session. Conversation metadata and reports remain until the local database is reset. Production retention, access auditing, legal holds and data deletion workflows are pending.
