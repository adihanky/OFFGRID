@account_recovery
Feature: Controlled recovery preserves provider separation and revokes prior sessions
  Background:
    Given an isolated account recovery fixture with controlled delivery

  @happy
  Scenario: Verify an existing email then reset its password
    When the owner verifies email through the controlled inbox
    And the owner consumes a password reset from that inbox
    Then the new password signs in and all previous owner sessions are revoked

  @negative
  Scenario: Unknown, unverified and provider-only accounts receive generic acknowledgments
    When reset requests target unknown, unverified and provider-only identities
    Then all acknowledgments match and no reset is delivered
    And cross-user session revocation and missing recovery CSRF are rejected

  @edge
  Scenario: Expired, replayed and concurrently consumed links cannot change credentials twice
    When the owner verifies email through the controlled inbox
    And two valid password reset links race
    Then exactly one reset commits and both original links become unusable
    And an expired verification link and a delivery outage remain safe
