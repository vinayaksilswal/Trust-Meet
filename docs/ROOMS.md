# Private rooms

An eligible host creates a named room for text, voice, or video, with capacity from two to twelve people including the host. Rooms can open immediately or within 30 days. Availability ends at the configured duration. Invite credentials are hashed and expire within an hour of the scheduled start or before the room closes, whichever comes first. Optional passwords are hashed, and joining is throttled.

Guests redeem the invitation and either receive admission if capacity permits or enter a bounded waiting room. Only the host can see its roster. Approval locks the room row while counting admitted members. A lock pauses new invitations and admission. Approved participants can still reconnect. Closing ends the room for everyone. Hosts can mute an active microphone or remove a guest. Removed guests cannot receive new media grants or redeem another invitation to that room.

Scheduled duration and admitted membership are tracked in PostgreSQL. Paid rooms, room reporting, historical occupancy, and enforceable provider revocation on hosted infrastructure remain open.
