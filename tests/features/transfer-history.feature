@transfer_history
Feature: Recoverable participant transfer history
  Background:
    Given isolated history participants with committed, rejected and pending sends

  @happy
  Scenario: Find completed sends and receipts from either side
    When the sender and recipient query their transfer history
    Then the sender sees all own outcomes and the recipient sees only committed transfers
    And the committed receipt and chain evidence match the persisted journal

  @negative
  Scenario: Private attempts and receipts stay participant scoped
    When another user queries transfer history and evidence
    Then private attempts and foreign receipts are unavailable
    And malformed history filters and cursors are rejected

  @edge
  Scenario: Equal timestamps and live outcomes across pages
    When the sender pages history with equal admission times
    Then every admitted transfer appears exactly once
    And changing the filters or caller invalidates the cursor
    And an archived asset and original v1 identity remain readable

  @edge
  Scenario: Admitted pending work survives a new session without local storage
    When the sender replaces its session with an empty browser jar
    Then server history discovers the original pending transfer
    And checking and recovering the original ID creates one financial effect
