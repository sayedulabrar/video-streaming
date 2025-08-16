# 📺 Video Processing System Architecture (with Auto-Cleanup)

## 🏗️ High-Level Textual Diagram

```
User
  │
  ▼
┌──────────────────────────────┐
│ Node.js Upload Service       │  ← AuthN/AuthZ (JWT/OAuth) + signed S3 URLs
│ - Accepts uploads            │
│ - Issues pre-signed PUT URLs │
└───────────────┬──────────────┘
                │ upload via URL
                ▼
┌──────────────────────────────┐
│ S3 (Temporary Bucket)        │  ← Lifecycle Policy (auto-delete, abort multipart)
│ temp.sayedulabrar14045.video │
└───────────────┬──────────────┘
     S3 Event   │  (Create *.mp4)
   Notification ▼
┌──────────────────────────────┐
│ SQS Queue: TempRawVideoS3Q   │  ← 1 min visibility timeout
└───────────────┬──────────────┘
                │ poll
                ▼
┌──────────────────────────────┐
│ Node.js Consumer / Orchestr. │
│ - Validate job               │
│ - Start ECS task             │
│ - Ack/Delete SQS msg (on ok) │
│ - (On fail: N retries → DLQ) │
└───────────────┬──────────────┘
                │ run task
                ▼
┌──────────────────────────────┐
│ ECS Task (Docker from ECR)   │
│ 1) Download raw from Temp S3 │
│ 2) Transcode/process         │
│ 3) Upload to Final S3        │
│ 4) Delete container temp     │
│ 5) Emit success/fail signal  │
└───────────────┬──────────────┘
                │ success
                ▼
┌──────────────────────────────┐
│ S3 (Processed Bucket)        │
│ Final/Published videos       │
└───────────────┬──────────────┘
                │ cleanup trigger
                ▼
┌──────────────────────────────┐
│ Cleanup Action               │
│ - Delete raw in Temp S3      │  ← via Orchestrator/Lambda
│ - (Lifecycle policy also     │     removes stragglers automatically)
└──────────────────────────────┘
```

---

## 🧹 Deletion & Auto-Cleanup Strategy

### Primary (Deterministic) Cleanup

* **Container ephemeral cleanup:** ECS task removes all local temp files after upload to Final S3.
* **Raw S3 delete:** After confirming processed output is safely stored, Orchestrator (or Lambda) **deletes the raw object** in Temp S3.
* **SQS message delete:** Consumer deletes the message only on successful orchestration (prevents reprocessing).

### Safety Net (Lifecycle Policy on Temp S3)

Even with robust app-level cleanup, some objects can linger (crashes, partial uploads). Apply a lifecycle policy on `temp.sayedulabrar14045.video`:

**Recommended lifecycle rules (no code—concept only):**

* **Expiration (short TTL):**

  * Delete objects under prefix `videos/` (or entire bucket) **after 24–48 hours**.
* **Abort incomplete multipart uploads:**

  * Automatically abort and remove **incomplete multipart uploads** after **1–2 days**.
* **(Optional) Previous versions:**

  * If versioning is enabled, **expire noncurrent versions** after **1–3 days**.
* **(Optional) Transition:**

  * Generally **not needed** for Temp S3, but you may transition to **S3 IA** after 1–3 days if TTL is longer.

**Benefits of lifecycle policy:**

* Cleans up **orphaned** raws if the worker or orchestrator fails mid-flow.
* Prevents **storage bloat** and keeps costs predictable.
* Handles **client-aborted uploads** via “abort incomplete multipart” automatically.

---

## 🔁 Failure Handling (Production-Grade)

* **Retries:** SQS redelivery after visibility timeout; Consumer attempts **N** times.
* **Dead-Letter Queue (DLQ):** On persistent failure, move message to **DLQ** for manual/automated remediation.
* **Idempotency:**

  * Use idempotent job keys to avoid duplicate processing on retries.
  * Only delete source raw after verifying the processed object exists and is complete in Final S3.
* **Observability:** Emit metrics/logs for: queue depth, task failure counts, processing latency, S3 errors.

---

## 🔐 Security & Access (Upload + Processing)

* **Upload Service:**

  * **JWT/OAuth** for client auth.
  * **Pre-signed S3 PUT URLs** scoped to `videos/{userId}/{uuid}.mp4` with short expiry (e.g., 5–15 min).
  * Enforce **content-type** and **suffix filters** (e.g., `.mp4`) at the app layer and in **S3 event filters**.
* **Least Privilege IAM:**

  * Upload service: only `PutObject` to Temp S3 at allowed prefixes.
  * Consumer/ECS task role: `GetObject` (Temp S3), `PutObject` (Final S3), *optional* `DeleteObject` (Temp S3).
  * S3 → SQS: queue policy allowing `s3.amazonaws.com` with `aws:SourceArn` condition.
* **Network posture:** Prefer **VPC-enabled ECS**; restrict public access where possible.

---

## 🌩️ Why This Whole Approach Scales (Node.js + AWS)

**System-wide benefits:**

* **Elastic throughput:** S3, SQS, ECS scale with demand; each layer is independently elastic.
* **Decoupled architecture:** Uploads (producer) are isolated from processing (consumer/workers); spikes in one don’t break the other.
* **Cost control:** Temp S3 + lifecycle policies + cleanup keep storage lean; pay-as-you-go compute with ECS tasks.
* **Resilience & durability:** SQS guarantees delivery; S3 provides 11-9s durability; DLQ avoids black-hole failures.
* **Operational simplicity:** Managed services (S3/SQS/ECS/ECR) reduce undifferentiated ops work.
* **Security by design:** Narrow IAM permissions, pre-signed URLs, and private ECR/ECS improve posture.
* **Performance:** Parallel ECS tasks enable **horizontal scaling** for transcoding; small, focused Node.js services keep latency low at the edge of the system.

---

## 📋 Quick Checklist (Configuration, no code)

* **S3 (Temp):** Event notification → SQS; lifecycle rules (expire 24–48h, abort incomplete 1–2 days).
* **SQS:** Visibility timeout 1 min; DLQ configured.
* **Upload Service:** Auth + pre-signed PUT URLs; suffix/content validation.
* **Consumer:** Validates message → starts ECS → deletes SQS msg only after success.
* **ECS Task:** Downloads raw, transcodes, uploads final, deletes ephemeral.
* **Cleanup:** App-level delete of raw; lifecycle as fallback.
* **IAM:** Least privilege across services.
* **Observability:** Metrics + logs for each stage.

