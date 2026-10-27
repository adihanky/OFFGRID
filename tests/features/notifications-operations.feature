@notifications_operations
Feature: Durable notifications and bounded read-only verification
  Background:
    Given an isolated operations fixture with a completed transfer

  @happy
  Scenario: Delivery persists one notification per participant and an idempotent read state
    When the outbox notification is delivered and delivered again
    Then each participant has one notification and strangers have none
    And marking the notification read twice preserves settlement

  @negative
  Scenario: Notification and operations access remain scoped
    When another user accesses notifications and verification jobs
    Then cross-user read and job access are rejected
    And unsupported verification scopes are rejected without financial writes

  @edge
  Scenario: A stale delivery worker cannot acknowledge a newer claim
    When a notification delivery loses its lease before acknowledgment
    Then no inbox rows or false delivery acknowledgment survive
    When a current delivery worker resumes after lease expiry
    Then each participant has one notification and strangers have none

  @edge
  Scenario: A restarted verification job resumes with a new claim
    When an auditor starts a verification job whose checkpoint lease changes
    Then the stale job cannot overwrite the newer claim
    When the read-only job resumes after lease expiry
    Then it completes all three checks without changing financial evidence
