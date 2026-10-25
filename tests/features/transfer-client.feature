@transfer_client
Feature: Confirmed client intent survives unresolved outcomes
  These scenarios exercise the real browser state and API helpers with controlled HTTP responses.
  They do not claim DOM rendering or interactive browser verification.

  Background:
    Given a reviewed client transfer of "1" precision 2

  @happy
  Scenario: C01 Confirmation freezes one canonical request
    When the reviewed client transfer is confirmed
    Then the client request quantity is "1.00"
    And the client intent and payload cannot be mutated
    When the server confirms the client transfer as "COMMITTED"
    Then the client outcome is terminal

  @edge
  Scenario: C03 Reload restores the same pending request identity
    When the reviewed client transfer is confirmed
    And the server confirms the client transfer as "PENDING"
    And the same user reloads the transfer tab
    Then the restored request keeps its original key and payload
    And the client outcome is unresolved

  @negative
  Scenario: C02 Rejection is an authoritative terminal outcome
    When the reviewed client transfer is confirmed
    And the server confirms the client transfer as "REJECTED"
    Then the client outcome is terminal
    And the client result is not committed

  @negative @edge
  Scenario: C02 A lost HTTP response preserves the original intent
    When the reviewed client transfer is confirmed
    And the transfer HTTP response is lost
    Then the client reports an unresolved connection outcome
    And the restored request keeps its original key and payload

  @negative
  Scenario Outline: C03 Identity changes clear private pending state
    When the reviewed client transfer is confirmed
    And the client session changes to "<identity>"
    Then no client transfer intent remains in storage
    Examples:
      | identity       |
      | signed out     |
      | another user   |
      | unauthorized   |

  @negative
  Scenario: C03 Account switch before submission cannot send the old intent
    When the reviewed client transfer is confirmed
    And the authenticated HTTP identity changes before submission
    Then the client refuses to post the stored transfer

  @edge @negative
  Scenario: C02 Interrupted response body preserves the confirmed request
    When the reviewed client transfer is confirmed
    And the transfer HTTP response body is interrupted
    Then the client reports an unresolved connection outcome
    And the restored request keeps its original key and payload

  @negative
  Scenario Outline: C02 Invalid quantities cannot reach confirmation
    When client review receives quantity "<quantity>"
    Then client review fails
    Examples:
      | quantity |
      | 0        |
      | -1       |
      | 1e2      |
      | 1.001    |

  @negative
  Scenario: C03 Corrupt stored intent is removed
    When client storage contains a malformed transfer intent
    Then no client transfer intent remains in storage
