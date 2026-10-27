@settings
Feature: Validated product policies have effective, audited revisions
  Background:
    Given an isolated enhancement administration fixture

  @happy
  Scenario: Published settings change review lifetime and invalidate an old review
    When the administrator publishes a validated review policy
    Then new recipient reviews use the published lifetime
    And an unsubmitted old review requires review again
    And the policy revision and reason persist in history

  @negative
  Scenario: Permissions, CSRF and supported bounds protect configuration
    When an ordinary user or an invalid publication targets settings
    Then configuration and audit remain unchanged

  @edge
  Scenario: Two publishers and a lost response cannot overwrite configuration
    When two policy publications race from the same revision
    Then exactly one publication wins and the other receives a stale revision
    And replaying the winning publication returns its original revision once
    And reusing its command for different values conflicts
