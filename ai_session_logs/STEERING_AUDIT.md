
# AI Steering Audit

## 1. AI-Assisted Iteration Log

| Iteration | Task / Prompt | AI Output Reviewed | Candidate Decision / Correction | Evidence |
|---|---|---|---|---|
| 1 | Implement a thread-safe vehicle checkout handler using MySQL transactions and idempotency. | AI proposed transaction-based checkout using SELECT FOR UPDATE, idempotency records, and HTTP conflict responses. | Reviewed the transaction flow and validated the implementation through concurrent checkout testing. | src/patch/checkout_handler.ts |
| 2 | Extend checkout testing to cover concurrent requests and idempotency scenarios. | AI generated tests for simultaneous checkout requests, idempotency replay, and idempotency key reuse. | Reviewed and executed the tests against the local MySQL database. Confirmed one successful checkout and four conflict responses. | src/patch/test_concurrency.ts |
| 3 | Improve fleet telemetry triage and dispatcher reliability. | AI proposed improvements to incident detection, maintenance classification, and exponential backoff retry handling. | Reviewed the generated implementation, identified missing edge cases, requested corrections, and expanded automated test coverage. | src/engine/triage_engine.ts; src/engine/dispatcher.ts |

## 2. AI Mistakes and Candidate Steering

### Mistake 1: Dispatcher Retry Logic

- What the AI got wrong:
  The initial dispatcher implementation contained exponential backoff logic, but its delivery adapter always succeeded. As a result, retry behavior could not be properly verified.

- How I detected it:
  I reviewed the delivery function and identified that it did not provide a failure scenario for testing.

- Prompt or instruction used to correct it:
  I instructed the AI to introduce dependency injection for the delivery function, sleep mechanism, and random jitter so that delivery failures could be simulated.

- Final verified result:
  Three dispatcher tests passed, covering retry success on the third attempt, maximum retry attempts, and invalid retry limits.

### Mistake 2: Incomplete Fleet Maintenance Detection

- What the AI got wrong:
  The initial triage implementation prioritized battery alerts when both battery voltage and fuel level were below their respective thresholds. This caused the fuel issue to be omitted from the incident description.

- How I detected it:
  I reviewed the maintenance detection logic and identified that simultaneous battery and fuel problems were not fully represented.

- Prompt or instruction used to correct it:
  I instructed the AI to capture both maintenance conditions within the same incident and provide corresponding maintenance recommendations.

- Final verified result:
  Eight fleet triage tests passed, including a test confirming that low battery and low fuel conditions are both recorded in one maintenance incident.

## 3. Verification Results

| Verification | Result |
|---|---|
| TypeScript typecheck | PASS |
| Production build | PASS |
| Unit tests | 11/11 PASS |
| Concurrent checkout | 1 success (HTTP 201), 4 conflicts (HTTP 409) |
| Idempotency replay | PASS — repeated request returns the original response |
| Idempotency key reuse with different payload | PASS — HTTP 409 |
| Fleet triage | PASS — 6 incidents generated |
| Dispatcher retry tests | 3/3 PASS |
| Dispatcher simulation | 6 incidents processed, 0 failures |

**Implementation limitations:**
- Dispatcher notifications run in simulation mode; no external notification provider is connected.
- Dual-WAN failover configuration is documented but has not been validated on physical network equipment.
- Concurrency tests use dedicated local test vehicle records and should not be executed against production data.

## 4. Candidate Evaluation and Responsibility

AI-generated code was treated as a technical proposal rather than an automatically accepted solution.

The implementation was reviewed, adjusted where necessary, and validated through local execution and automated testing.

The candidate retained responsibility for technical decisions, test execution, and verification of the final implementation.

**Note:** Dispatcher delivery was simulated locally. No external notification provider was contacted. Network failover configuration was documented but not physically validated on network hardware.
