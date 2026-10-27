@consumer_requests
Feature: Consumers track administrator decisions without self-grant or self-mint
  Background:
    Given an isolated consumer request fixture

  @happy
  Scenario: An authorized administrator approves tracked access and allocation requests
    When the consumer requests access and 5.00 demo units
    Then the requests alone change no role or balance
    When the category administrator explicitly approves both requests
    Then the consumer sees linked decisions with one grant and one balanced issuance

  @negative
  Scenario: Wrong roles, self-approval, stale input and conflicting keys have no effect
    When a consumer attempts unauthorized request decisions
    Then the request remains open with no role or balance effect

  @edge
  Scenario: Failure before the decision checkpoint rolls back the domain effect
    When an allocation decision loses its checkpoint inside the transaction
    Then the allocation and request decision both roll back
    When the same administrator decision is retried and replayed
    Then the request and financial effect commit exactly once
