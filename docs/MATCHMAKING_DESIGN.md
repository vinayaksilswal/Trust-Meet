# Matchmaking design

Redis stores a 15-second availability lease per authenticated user and an expiry-ranked index per mode. The browser refreshes the lease while searching. Lease creation and cancellation use Lua, with generation IDs so a delayed heartbeat cannot recreate a cancelled search. A mode scan considers at most 64 other candidates. Language and country preferences compare when both sides specify them. If both sides enter interests, they must share at least one. Compatible entries rank by interest overlap and queue age. The current country selector is scoped to India.

A PostgreSQL transaction verifies both accounts and active session conflicts, filters blocks and recent partners, and reserves both participants atomically. The database enforces one open reservation per user. A match invitation lasts 35 seconds. Media access requires both parties to accept. A session lasts up to 20 minutes. Ending or skipping suppresses repeat pairing for five minutes.

The initial implementation uses a shared PostgreSQL advisory lock and a bounded Redis scan. Capacity, candidate fairness in large mixed queues, disconnect timing under load, and quality metrics still need verification. A failure after Redis removes leases and before the database commits can require users to restart their search. Participants never receive a speculative match.
