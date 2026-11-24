# KaptureOTG Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Strict Ownership**: Every `CaptureProject` under `/projects/{projectId}` and every `UserPreference` under `/userPreferences/{userId}` can only be read, created, updated, or deleted by its verified authenticated owner (`request.auth.uid == ownerId` and `request.auth.token.email_verified == true`).
2. **Master Gate Relational Integrity**: Every `CaptureRecording` under `/projects/{projectId}/recordings/{recordingId}` cannot be read (get), created, updated, or deleted unless the parent `/projects/{projectId}` document exists and its `ownerId == request.auth.uid`.
3. **Immutable Lineage & Temporal Integrity**: `ownerId`, `projectId`, and `createdAt` are strictly immutable after creation. `createdAt == request.time` on create and `updatedAt == request.time` on create and update.
4. **Terminal State Locking**: Once a `CaptureRecording` transitions to `status == 'archived'`, no further client mutations are allowed.
5. **Zero Shadow Fields & Bounded Volumes**: Every write enforces `keys().hasAll(...) && keys().hasOnly(...)` on create and action-scoped `affectedKeys().hasOnly(...)` on update, with explicit `.size()` bounds on every string and array.
6. **PII Isolation**: No email, phone, or physical address is stored in Firestore documents; identity info remains strictly in Firebase Auth.

## 2. The "Dirty Dozen" Adversarial Payloads (All Must Return PERMISSION_DENIED)
1. **Identity Spoofing on Create**: Creating `/projects/proj_1` with `ownerId: "victim_uid"` while authenticated as `"attacker_uid"`.
2. **Unverified Email Write**: Creating `/projects/proj_2` with `request.auth.token.email_verified == false`.
3. **Shadow Field Injection (Ghost Field)**: Creating or updating `/projects/proj_1` with an extra field `{ "isAdmin": true }`.
4. **Path Variable ID Poisoning**: Creating `/projects/../../../etc/passwd` or a 200-character invalid document ID.
5. **Orphaned Subcollection Recording**: Creating `/projects/nonexistent_proj/recordings/rec_1` where parent project does not exist or belongs to another user.
6. **Immutable Field Tampering**: Updating `/projects/proj_1` to change `ownerId` or `createdAt`.
7. **Client Timestamp Forgery**: Creating `/projects/proj_1` with a backdated client timestamp (`createdAt != request.time`).
8. **Value Poisoning (Out-of-Bounds Resolution/Bitrate)**: Updating `/projects/proj_1` with `videoBitrateMbps: 9999` or `rotation: 45`.
9. **Terminal State Violation**: Updating `/projects/proj_1/recordings/rec_1` when `existing().status == 'archived'`.
10. **Array Element Poisoning**: Creating or updating `CaptureRecording` with `publishedPlatforms: ["malicious_site"]` or more than 6 entries.
11. **Unscoped List Scraping**: Querying `/projects` without filtering `where('ownerId', '==', auth.uid)`.
12. **Cross-User Preference Hijack**: Reading or writing `/userPreferences/victim_uid` while signed in as `"attacker_uid"`.
