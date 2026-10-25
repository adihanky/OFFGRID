Feature: Demo custody and financial settlement
  Issuance and transfers record custody in the same database transaction as money.

  Scenario: O05 Issuance split merge and multihop conserve exact demo units
    Given an isolated custody graph with three issued roots
    When Alice sends 125.25 to Bob and Bob sends 1100.00 to Carol in the custody fixture
    Then the custody graph reconciles with exact recipient and change lots

  Scenario: O05 Tampering with an allocation is detected
    Given an isolated custody graph with three issued roots
    When Alice sends 125.25 to Bob and Bob sends 1100.00 to Carol in the custody fixture
    And a custody allocation edge is removed
    Then custody verification reports the broken graph

  Scenario: O05 An aborted custody transaction leaves no graph effects
    Given an isolated custody graph with three issued roots
    When a custody write fails before its transaction commits
    Then the custody lots events edges and head remain unchanged

  Scenario: O05 The smallest unit retains exact provenance
    Given an isolated custody graph with three issued roots
    When Alice transfers one base unit through the custody fixture
    Then one base unit has a recipient lot and the graph verifies
