# Database design

The first Alembic revision creates users, hashed login sessions, single-use account tokens, eligibility outcomes, conversations, participants, blocks and reports. Entities use UUIDs where a record needs an independent identifier. Hashes serve as identifiers for opaque credentials. Participant rows use a conversation and user composite key. A partial unique index permits at most one unreleased participant record per user across all conversations. Blocks are unique and directional. Reports are unique per reporter and conversation.

Conversation transitions run in a transaction. Acceptance sets the start time and session deadline. End or expiry sets the end time, releases participants and clears invitation credentials. A periodic sweep revisits ended rooms until LiveKit cleanup succeeds. Timed sessions have persisted start and end times. Billing-grade usage metering is pending.

Private rooms have independent UUIDs, time windows, hashed optional passwords, expiring hashed invitations, and participant records with waiting, approved, or removed states. The room row is locked while admitting participants so capacity is consistent across simultaneous approvals.
