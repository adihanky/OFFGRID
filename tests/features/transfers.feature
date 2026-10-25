@transfer
Feature: Atomic authenticated transfers with durable request identity
  Background:
    Given isolated transfer peers and a precision-2 asset
    And Alice has "1000" base units

  @happy
  Scenario: T01 Atomic settlement and authorized details
    When Alice transfers "3.25" to Bob
    Then the transfer HTTP status is 201
    And the transfer is "COMMITTED"
    And Alice has "675" and Bob has "325" stored units
    And exactly 1 complete transfer effects exist
    And the response contains no private transfer metadata
    And ledger reconciliation is clean
    And the transfer chain is valid
    When Bob reads the last transfer
    Then the transfer HTTP status is 200
    When Carol reads the last transfer
    Then the transfer HTTP status is 404

  @negative
  Scenario Outline: W06 T02 Invalid admission does not persist requests
    When Alice submits a transfer with "<problem>"
    Then the transfer HTTP status is <status>
    And no transfer requests or settlement effects exist
    Examples:
      | problem              | status |
      | zero                 | 400    |
      | negative             | 400    |
      | exponent             | 400    |
      | numeric quantity     | 400    |
      | whitespace           | 400    |
      | excess precision     | 400    |
      | oversized quantity   | 400    |
      | overflow quantity    | 400    |
      | unknown field        | 400    |
      | sender injection     | 400    |
      | malformed recipient  | 400    |
      | unsupported asset    | 400    |
      | self transfer        | 400    |
      | missing key          | 400    |
      | malformed key        | 400    |
      | missing csrf         | 403    |
      | another session csrf | 403    |
      | foreign origin       | 403    |

  @negative
  Scenario Outline: T04 Ineligible destination rejects without settlement
    Given the transfer eligibility problem is "<problem>"
    When Alice transfers "1.00" to Bob
    Then the transfer HTTP status is 422
    And the rejection reason is "<reason>"
    And no settlement effects exist
    Examples:
      | problem                    | reason                |
      | disabled recipient         | RECIPIENT_UNAVAILABLE |
      | missing recipient          | RECIPIENT_UNAVAILABLE |
      | disabled asset             | ASSET_UNAVAILABLE     |
      | disabled sender account    | ACCOUNT_UNAVAILABLE   |
      | disabled recipient account | ACCOUNT_UNAVAILABLE   |

  @negative
  Scenario: T05 Insufficient balance is a durable stable rejection
    When Alice transfers "10.01" to Bob
    Then the transfer HTTP status is 422
    And the rejection reason is "INSUFFICIENT_BALANCE"
    And no settlement effects exist
    When Bob reads the last transfer
    Then the transfer HTTP status is 404
    When Alice replays the last request with quantity "10.01"
    Then the transfer HTTP status is 422
    And the rejection reason is "INSUFFICIENT_BALANCE"
    And exactly 1 transfer requests exist

  @edge
  Scenario: T05 Exact available balance can be spent
    When Alice transfers "10.00" to Bob
    Then the transfer is "COMMITTED"
    And Alice has "0" and Bob has "1000" stored units
    And exactly 1 complete transfer effects exist

  @negative
  Scenario: T05 Recipient overflow rolls back sender debit
    Given Bob's stored balance is set to "9223372036854775807"
    When Alice transfers "0.01" to Bob
    Then the rejection reason is "BALANCE_LIMIT_EXCEEDED"
    And Alice has "1000" and Bob has "9223372036854775807" stored units
    And no settlement effects exist

  @edge @concurrency
  Scenario: T06 Competing debits cannot overspend
    When Alice concurrently sends "7.00" to Bob and Carol
    Then one transfer commits and one rejects for insufficient balance
    And Alice has "300" stored units
    And Bob and Carol together have "700" stored units
    And exactly 1 complete transfer effects exist

  @edge @concurrency
  Scenario: T07 Concurrent credits provision one account and contiguous chain
    Given Carol has "1000" base units
    When Alice and Carol concurrently send "1.00" to Bob
    Then Bob has "200" stored units in one account
    And exactly 2 complete transfer effects exist
    And the transfer chain is valid

  @happy @edge
  Scenario: T08 Equivalent decimal requests replay one identity
    When Alice transfers "1" to Bob
    And Alice replays the last request with quantity "1.00"
    Then the transfer HTTP status is 200
    And the original transfer identity is returned
    And exactly 1 complete transfer effects exist
    And Alice has "900" and Bob has "100" stored units

  @edge @concurrency
  Scenario: T08 Concurrent duplicate admission has one effect
    When Alice concurrently submits the same request twice
    Then both submissions refer to the same transfer
    And exactly 1 complete transfer effects exist

  @negative
  Scenario Outline: T09 Reusing a key with different content conflicts
    When Alice transfers "1.00" to Bob
    And Alice reuses the request key changing "<field>"
    Then the transfer HTTP status is 409
    And exactly 1 complete transfer effects exist
    Examples:
      | field             |
      | quantity          |
      | recipient         |
      | asset             |
      | unsupported asset |

  @edge
  Scenario: T09 Identical keys belong to individual senders
    Given Carol has "1000" base units
    When Alice transfers "1.00" to Bob
    And Carol submits the same key to Bob
    Then the transfer is "COMMITTED"
    And exactly 2 complete transfer effects exist

  @edge
  Scenario: T10 Terminal replay survives asset disablement
    When Alice transfers "1.00" to Bob
    And the asset is disabled
    And Alice replays the last request with quantity "1.0"
    Then the transfer HTTP status is 200
    And the transfer is "COMMITTED"
    And the original transfer identity is returned
    And exactly 1 complete transfer effects exist

  @negative
  Scenario: T11 Unknown and unrelated transfer details are indistinguishable
    When Alice transfers "1.00" to Bob
    And Carol compares unknown and unrelated transfer details
    Then both missing detail responses are identical

  @edge
  Scenario Outline: W05 Transfer amounts retain exact precision
    Given a precision-<precision> boundary asset with "<units>" Alice units
    When Alice transfers "<quantity>" to Bob
    Then the transfer is "COMMITTED"
    And Alice has "0" and Bob has "<units>" stored units
    And exactly 1 complete transfer effects exist
    Examples:
      | precision | units               | quantity             |
      | 0         | 1                   | 1                    |
      | 8         | 1                   | 0.00000001           |
      | 0         | 9007199254740993     | 9007199254740993      |
      | 2         | 9223372036854775807  | 92233720368547758.07 |

  @negative
  Scenario: T03 Admission throttling preserves existing request recovery
    When Alice transfers "1.00" to Bob
    And Alice's transfer admission allowance is exhausted
    And Alice submits a fresh transfer without replacing the original intent
    Then the transfer HTTP status is 429
    And exactly 1 transfer requests exist
    When Alice replays the last request with quantity "1.00"
    Then the transfer HTTP status is 200
    And exactly 1 complete transfer effects exist

  @negative
  Scenario Outline: W10 Chain verification detects corruption
    When Alice transfers "1.00" to Bob
    And the transfer chain is corrupted at "<part>"
    Then the transfer chain reports corruption
    Examples:
      | part    |
      | payload |
      | hash    |
      | missing |
      | head    |
      | journal |
