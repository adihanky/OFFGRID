Feature: Reviewed v2 simulated transfers
  V2 binds server resolved wallets and keeps v1 request identities distinct.

  Background:
    Given an isolated funded v2 transfer fixture

  Scenario: O04 A reviewed logged-out recipient receives one atomic custody transfer
    When the v2 sender confirms 3.25 for the resolved recipient
    Then the v2 transfer commits with balances 6.75 and 3.25 and valid custody

  Scenario: O10 A terminal v2 replay survives review expiry and cannot be replayed as v1
    When the v2 sender confirms 3.25 for the resolved recipient
    And the stored v2 review expires
    And the v2 sender retries the unchanged intent
    Then the original v2 result is returned with one complete financial effect
    And the same key through v1 conflicts

  Scenario: O03 Suspension after resolution requires fresh review without admission
    Given the v2 recipient wallet was suspended after review
    When the v2 sender confirms 3.25 for the resolved recipient
    Then v2 returns review required with no transfer admission or effects

  Scenario: O09 A resolution cannot be submitted by another caller
    When another caller submits the v2 sender resolution
    Then v2 returns review required with no transfer admission or effects

  Scenario: O09 Invalid v2 reviews cannot bypass the admission request limit
    When another caller repeatedly submits the foreign v2 resolution
    Then v2 rejects the excess reviews without financial admission

  Scenario: O11 Pausing an asset invalidates an unsubmitted review
    Given the v2 asset was paused after review
    When the v2 sender confirms 3.25 for the resolved recipient
    Then v2 returns review required with no transfer admission or effects

  Scenario: O04 Concurrent duplicate v2 confirmations have one effect
    When two v2 confirmations race under the same key
    Then the original v2 result is returned with one complete financial effect

  Scenario: O04 A failure after custody aborts every settlement write and resumes safely
    Given v2 settlement fails after writing custody
    When the v2 sender confirms 3.25 for the resolved recipient
    Then the v2 request is pending with unchanged balances and custody roots
    When the v2 pending transfer is recovered
    Then the original v2 result is returned with one complete financial effect
